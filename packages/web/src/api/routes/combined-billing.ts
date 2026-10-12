import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { manager } from "../middleware/manager";
import {
  loadCombinedSources,
  nextCombinedSequence,
  prepareCombined,
} from "../lib/combined-billing";
import { buildXeroCsv } from "../lib/xero";
import { syncBlankLinePrices } from "../lib/pricing";

const rangeFields = { from: z.iso.date(), to: z.iso.date() };
const range = z
  .object(rangeFields)
  .refine((r) => r.from <= r.to && Date.parse(r.to) - Date.parse(r.from) <= 366 * 86400000, {
    message: "Choose a valid delivery period of at most one year.",
  });
const selection = z
  .object({
    ...rangeFields,
    invoiceDate: z.iso.date(),
    orderIds: z.array(z.number().int().positive()).max(1000),
    deliveries: z
      .array(z.object({ subscriptionId: z.number().int().positive(), deliveryDate: z.iso.date() }))
      .max(1000),
  })
  .refine((r) => r.from <= r.to && Date.parse(r.to) - Date.parse(r.from) <= 366 * 86400000, {
    message: "Choose a valid delivery period of at most one year.",
  });

export const combinedBilling = {
  combinedOptions: manager.input(range).handler(({ input }) =>
    loadCombinedSources(input.from, input.to).then(({ sources, settings }) => ({
      sources,
      dueDays: settings.dueDays,
      currency: settings.currency,
    })),
  ),

  combinedPreview: manager.input(selection).handler(async ({ input }) => {
    const result = await prepareCombined(input);
    return {
      fingerprint: result.fingerprint,
      total: result.total,
      invoiceCount: result.invoices.length,
      dueDays: result.settings.dueDays,
      invoiceDate: input.invoiceDate,
      dueDate: result.invoices[0]?.invoice.dueDate,
      invoices: result.invoices.map((row) => ({
        customerKey: row.customerKey,
        contactName: row.invoice.contactName,
        email: row.invoice.email,
        matchedCustomers: row.matchedCustomers,
        sources: row.sources.map((s) => ({
          key: s.key,
          label: s.label,
          total: s.total,
          type: s.type,
        })),
        lines: row.invoice.lines,
        total: row.total,
      })),
    };
  }),

  runCombined: manager
    .input(selection.safeExtend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }))
    .handler(async ({ input }) => {
      const { fingerprint, ...chosen } = input;
      try {
        return await db.transaction(async (tx) => {
          const prepared = await prepareCombined(chosen, tx);
          if (prepared.fingerprint !== fingerprint)
            throw new ORPCError("CONFLICT", {
              message:
                "Prices, contacts or billing settings changed after review. Review the invoices again; nothing was generated.",
            });
          let sequence = await nextCombinedSequence(tx, prepared.invoices.length);
          for (const row of prepared.invoices)
            row.invoice.invoiceNumber = `INV-${String(sequence++).padStart(4, "0")}`;
          const csv = buildXeroCsv(
            prepared.invoices.map((r) => r.invoice),
            prepared.settings,
          );
          const fileName = `xero-combined-${input.invoiceDate}.csv`;
          const [batch] = await tx
            .insert(schema.invoiceBatches)
            .values({
              type: "combined",
              label: `Combined invoices ${input.from} → ${input.to}`,
              fromDate: input.from,
              toDate: input.to,
              invoiceCount: prepared.invoices.length,
              lineCount: prepared.invoices.reduce((n, r) => n + r.invoice.lines.length, 0),
              total: prepared.total,
              fileName,
              csv,
            })
            .returning();
          await syncBlankLinePrices(input.orderIds, tx);
          for (const row of prepared.invoices) {
            for (const source of row.sources) {
              if (source.type === "order") {
                const updated = await tx
                  .update(schema.orders)
                  .set({
                    invoiceStatus: "invoiced",
                    invoiceNumber: row.invoice.invoiceNumber,
                    batchId: batch.id,
                  })
                  .where(
                    and(
                      eq(schema.orders.id, source.orderId!),
                      eq(schema.orders.invoiceStatus, "pending"),
                    ),
                  )
                  .returning({ id: schema.orders.id });
                if (updated.length !== 1)
                  throw new ORPCError("CONFLICT", {
                    message: "An order was invoiced elsewhere. Refresh; nothing was generated.",
                  });
              } else {
                await tx
                  .insert(schema.deliveries)
                  .values({
                    subscriptionId: source.subscriptionId!,
                    deliveryDate: source.date,
                    invoiceNumber: row.invoice.invoiceNumber,
                    total: source.total,
                    batchId: batch.id,
                    status: "invoiced",
                  });
              }
            }
          }
          return {
            batchId: batch.id,
            fileName,
            csv,
            invoiceCount: prepared.invoices.length,
            total: prepared.total,
          };
        });
      } catch (error) {
        if (error instanceof ORPCError) throw error;
        const text = String(error) + (error instanceof Error ? String(error.cause) : "");
        if (/SQLITE_BUSY|SQLITE_LOCKED|UNIQUE constraint failed: deliveries/i.test(text)) {
          throw new ORPCError("CONFLICT", {
            message:
              "Another billing run changed these sources. Refresh and review again; nothing was generated.",
          });
        }
        throw error;
      }
    }),
};
