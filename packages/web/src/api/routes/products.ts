import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { manager as base } from "../middleware/manager";
import { db } from "../database";
import * as schema from "../database/schema";
import { num, parseCsvRecords, pick, toCsv } from "../lib/csv";
import { getSettings } from "../lib/settings";

const kinds = ["product", "box", "shipping", "discount"] as const;

/**
 * Imported order lines carry their own price, and SKUs auto-created during an import start
 * with none — so pricing the catalog item has to fill those blanks, otherwise the order can
 * never be invoiced. Lines that already have a price keep it: that was the price charged.
 */
async function fillBlankLinePrices(productId: number, unitPrice: number | null): Promise<number> {
  if (unitPrice === null) return 0;
  const pending = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(eq(schema.orders.invoiceStatus, "pending"));
  if (pending.length === 0) return 0;
  const updated = await db
    .update(schema.orderLines)
    .set({ unitPrice })
    .where(
      and(
        eq(schema.orderLines.productId, productId),
        isNull(schema.orderLines.unitPrice),
        inArray(
          schema.orderLines.orderId,
          pending.map((o) => o.id),
        ),
      ),
    )
    .returning();
  return updated.length;
}

const productInput = z.object({
  sku: z.string().min(1),
  description: z.string().min(1),
  unitPrice: z.number().nullable(),
  accountCode: z.string().nullable().optional(),
  taxType: z.string().nullable().optional(),
  trackingOption: z.string().nullable().optional(),
  kind: z.enum(kinds).default("product"),
  active: z.boolean().default(true),
});

export const products = {
  list: base.handler(async () => {
    const rows = await db.select().from(schema.products).orderBy(asc(schema.products.sku));
    const aliases = await db.select().from(schema.productAliases);
    return rows.map((p) => ({
      ...p,
      aliases: aliases.filter((a) => a.productId === p.id).map((a) => a.aliasText),
    }));
  }),

  create: base.input(productInput).handler(async ({ input }) => {
    const sku = input.sku.trim().toUpperCase();
    const [existing] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.sku, sku));
    if (existing) throw new ORPCError("CONFLICT", { message: `SKU ${sku} already exists` });
    const s = await getSettings();
    const [row] = await db
      .insert(schema.products)
      .values({
        ...input,
        sku,
        accountCode: input.accountCode || s.defaultAccountCode,
        taxType: input.taxType || s.defaultTaxType,
        trackingOption: input.trackingOption || s.defaultTrackingOption,
      })
      .returning();
    return row;
  }),

  update: base
    .input(productInput.partial().extend({ id: z.number() }))
    .handler(async ({ input }) => {
      const { id, ...rest } = input;
      const values = { ...rest };
      if (values.sku) values.sku = values.sku.trim().toUpperCase();
      const [row] = await db
        .update(schema.products)
        .set(values)
        .where(eq(schema.products.id, id))
        .returning();
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Product not found" });
      if (values.unitPrice !== undefined) await fillBlankLinePrices(row.id, row.unitPrice);
      return row;
    }),

  remove: base.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    await db.delete(schema.productAliases).where(eq(schema.productAliases.productId, input.id));
    await db.delete(schema.products).where(eq(schema.products.id, input.id));
    return { ok: true };
  }),

  removeAlias: base.input(z.object({ aliasText: z.string() })).handler(async ({ input }) => {
    await db.delete(schema.productAliases).where(eq(schema.productAliases.aliasText, input.aliasText));
    return { ok: true };
  }),

  /**
   * Import a Xero "Products & Services" export or any CSV with SKU/description/price
   * columns. Existing SKUs are updated, new ones created.
   */
  importCsv: base
    .input(z.object({ csv: z.string(), updateExisting: z.boolean().default(true) }))
    .handler(async ({ input }) => {
      const { records } = parseCsvRecords(input.csv);
      const s = await getSettings();
      let created = 0;
      let updated = 0;
      let linesFilled = 0;
      const skipped: string[] = [];

      for (const rec of records) {
        const sku = pick(rec, "ItemCode", "*ItemCode", "SKU", "Code", "Item Code", "InventoryItemCode")
          .trim()
          .toUpperCase();
        if (!sku) {
          skipped.push(JSON.stringify(rec).slice(0, 80));
          continue;
        }
        const description =
          pick(rec, "SalesDescription", "Description", "ItemName", "Name", "Item Name") || sku;
        const priceRaw = pick(rec, "SalesUnitPrice", "UnitPrice", "Price", "Sales Price", "Amount");
        const unitPrice = priceRaw ? num(priceRaw) : null;
        const accountCode =
          pick(rec, "SalesAccount", "AccountCode", "Sales Account", "Account") || s.defaultAccountCode;
        const taxType = pick(rec, "SalesTaxRate", "TaxType", "Tax Type", "TaxRate") || s.defaultTaxType;

        const [existing] = await db.select().from(schema.products).where(eq(schema.products.sku, sku));
        if (existing) {
          if (!input.updateExisting) continue;
          await db
            .update(schema.products)
            .set({
              description: description || existing.description,
              unitPrice: unitPrice ?? existing.unitPrice,
              accountCode,
              taxType,
            })
            .where(eq(schema.products.id, existing.id));
          linesFilled += await fillBlankLinePrices(existing.id, unitPrice ?? existing.unitPrice);
          updated++;
        } else {
          const [row] = await db
            .insert(schema.products)
            .values({
              sku,
              description,
              unitPrice,
              accountCode,
              taxType,
              trackingOption: s.defaultTrackingOption,
              kind: "product",
            })
            .returning();
          linesFilled += await fillBlankLinePrices(row.id, unitPrice);
          created++;
        }
      }
      return { created, updated, skipped: skipped.length, linesFilled };
    }),

  exportCsv: base.handler(async () => {
    const rows = await db.select().from(schema.products).orderBy(asc(schema.products.sku));
    const csv = toCsv(
      [
        "SKU",
        "Description",
        "UnitPrice",
        "AccountCode",
        "TaxType",
        "TrackingOption",
        "Kind",
        "Active",
      ],
      rows.map((p) => [
        p.sku,
        p.description,
        p.unitPrice ?? "",
        p.accountCode ?? "",
        p.taxType ?? "",
        p.trackingOption ?? "",
        p.kind,
        p.active ? "yes" : "no",
      ]),
    );
    return { csv, fileName: `catalog-${new Date().toISOString().slice(0, 10)}.csv` };
  }),

  /** Bulk price update from the "needs price" screen. */
  setPrices: base
    .input(z.object({ prices: z.array(z.object({ id: z.number(), unitPrice: z.number() })) }))
    .handler(async ({ input }) => {
      let linesFilled = 0;
      for (const p of input.prices) {
        await db
          .update(schema.products)
          .set({ unitPrice: p.unitPrice })
          .where(eq(schema.products.id, p.id));
        linesFilled += await fillBlankLinePrices(p.id, p.unitPrice);
      }
      return { updated: input.prices.length, linesFilled };
    }),

  stats: base.handler(async () => {
    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.products);
    const [{ count: missingPrice }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.products)
      .where(sql`${schema.products.unitPrice} is null or ${schema.products.unitPrice} = 0`);
    return { total, missingPrice };
  }),

  byIds: base.input(z.object({ ids: z.array(z.number()) })).handler(async ({ input }) => {
    if (input.ids.length === 0) return [];
    return db.select().from(schema.products).where(inArray(schema.products.id, input.ids));
  }),
};
