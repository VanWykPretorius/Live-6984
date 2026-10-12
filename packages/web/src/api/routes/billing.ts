import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { manager as base } from "../middleware/manager";
import { db } from "../database";
import * as schema from "../database/schema";
import { deliveryDatesInRange, thursdayOfWeek, todayIso, weekRange } from "../lib/schedule";
import { syncBlankLinePrices } from "../lib/pricing";
import { getSettings, type Settings } from "../lib/settings";
import { addDays, buildXeroCsv, invoiceTotal, round2, type XeroInvoice } from "../lib/xero";
import { loadSubscriptions } from "./subscriptions";
import type { BillingDb } from "../lib/billing-db";
import { reserveInvoiceSequence } from "../lib/invoice-sequences";

type Sub = Awaited<ReturnType<typeof loadSubscriptions>>[number];

export function customerFields(c: typeof schema.customers.$inferSelect) {
  return {
    contactName: c.company?.trim() || c.name,
    email: c.email,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    region: c.region,
    postalCode: c.postalCode,
    country: c.country,
  };
}

type ShippingItem = {
  itemCode: string | null;
  description: string;
  accountCode: string;
  taxType: string;
  trackingOption: string | null;
};

/**
 * Billing details for shipping lines. Shipping is a real catalog item (Settings' shipping SKU,
 * e.g. SHIP001), so its account code, tax type and tracking come from that product and stay in
 * step with Xero. The Settings shipping fields are only a fallback for when the SKU is missing
 * from the catalog.
 */
export async function shippingItem(s: Settings, database: BillingDb = db): Promise<ShippingItem> {
  const sku = s.shippingSku.trim();
  const [p] = sku
    ? await database.select().from(schema.products).where(eq(schema.products.sku, sku)).limit(1)
    : [];
  return {
    itemCode: p?.sku ?? (sku || null),
    description: p?.description?.trim() || s.shippingDescription,
    accountCode: p?.accountCode || s.shippingAccountCode || s.defaultAccountCode,
    taxType: p?.taxType || s.shippingTaxType || s.defaultTaxType,
    trackingOption: p?.trackingOption || s.shippingTrackingOption || s.defaultTrackingOption,
  };
}

export function subscriptionInvoice(
  sub: Sub,
  deliveryDate: string,
  invoiceNumber: string,
  s: Settings,
  ship: ShippingItem,
): XeroInvoice {
  const lines: XeroInvoice["lines"] = [];
  lines.push({
    itemCode: sub.box?.sku ?? (s.defaultBoxSku || null),
    description: sub.box?.description ?? "Vegetable Box",
    quantity: sub.boxQuantity,
    unitAmount: sub.boxPrice,
    accountCode: sub.box?.accountCode ?? s.defaultAccountCode,
    taxType: sub.box?.taxType ?? s.defaultTaxType,
    trackingOption: sub.box?.trackingOption || s.defaultTrackingOption,
  });
  for (const a of sub.addons) {
    lines.push({
      itemCode: a.sku || null,
      description: a.description || a.sku,
      quantity: a.quantity,
      unitAmount: a.effectivePrice ?? 0,
      accountCode: a.accountCode || s.defaultAccountCode,
      taxType: a.taxType || s.defaultTaxType,
      trackingOption: a.trackingOption || s.defaultTrackingOption,
    });
  }
  if (sub.includeShipping && sub.shippingAmount > 0) {
    lines.push({
      itemCode: ship.itemCode,
      description: ship.description,
      quantity: 1,
      unitAmount: sub.shippingAmount,
      accountCode: ship.accountCode,
      taxType: ship.taxType,
      trackingOption: ship.trackingOption,
    });
  }
  return {
    ...customerFields(sub.customer),
    invoiceNumber,
    reference: sub.reference || `Box delivery ${deliveryDate}`,
    invoiceDate: deliveryDate,
    dueDate: addDays(deliveryDate, s.dueDays),
    currency: s.currency,
    brandingTheme: s.brandingTheme,
    lines,
  };
}

/** Deliveries due in [from,to] that have not been invoiced or skipped yet. */
export async function dueDeliveries(from: string, to: string, database: BillingDb = db) {
  const subs = await loadSubscriptions(database);
  const existing = await database.select().from(schema.deliveries);
  const out: { sub: Sub; deliveryDate: string; perDelivery: number; blocked: string[] }[] = [];
  for (const sub of subs) {
    if (sub.status === "cancelled") continue;
    for (const date of deliveryDatesInRange(sub, from, to)) {
      const already = existing.find((d) => d.subscriptionId === sub.id && d.deliveryDate === date);
      if (already) continue;
      const blocked: string[] = [];
      if (!sub.box && !sub.boxPrice) blocked.push("no box product or price");
      for (const a of sub.addons) {
        if (a.effectivePrice === null || a.effectivePrice === 0) {
          blocked.push(`${a.sku || a.description} has no price`);
        }
      }
      out.push({ sub, deliveryDate: date, perDelivery: sub.perDelivery, blocked });
    }
  }
  return out.sort((a, b) =>
    a.deliveryDate === b.deliveryDate
      ? a.sub.customer.name.localeCompare(b.sub.customer.name)
      : a.deliveryDate.localeCompare(b.deliveryDate),
  );
}

export const billing = {
  /** Default range: current week (Mon–Sun). */
  defaultRange: base.handler(() => weekRange(todayIso())),

  preview: base.input(z.object({ from: z.string(), to: z.string() })).handler(async ({ input }) => {
    const rows = await dueDeliveries(input.from, input.to);
    return rows.map((r) => ({
      subscriptionId: r.sub.id,
      customerName: r.sub.customer.name,
      company: r.sub.customer.company,
      frequency: r.sub.frequency,
      deliveryDate: r.deliveryDate,
      boxSku: r.sub.box?.sku ?? "",
      boxDescription: r.sub.box?.description ?? "Vegetable Box",
      boxQuantity: r.sub.boxQuantity,
      boxPrice: r.sub.boxPrice,
      addons: r.sub.addons.map((a) => ({
        sku: a.sku,
        description: a.description,
        quantity: a.quantity,
        unitPrice: a.effectivePrice,
      })),
      includeShipping: r.sub.includeShipping,
      shippingAmount: r.sub.shippingAmount,
      total: r.perDelivery,
      blocked: r.blocked,
    }));
  }),

  /** Generate the subscription invoice CSV for the selected deliveries. */
  runSubscriptions: base
    .input(
      z.object({
        from: z.string(),
        to: z.string(),
        deliveries: z.array(z.object({ subscriptionId: z.number(), deliveryDate: z.string() })),
      }),
    )
    .handler(async ({ input }) => {
      if (input.deliveries.length === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "Select at least one delivery." });
      }
      return db.transaction(async (tx) => {
        const s = await getSettings(tx);
        const all = await dueDeliveries(input.from, input.to, tx);
        const chosen = all.filter((r) =>
          input.deliveries.some(
            (d) => d.subscriptionId === r.sub.id && d.deliveryDate === r.deliveryDate,
          ),
        );
        if (chosen.length !== input.deliveries.length)
          throw new ORPCError("CONFLICT", {
            message:
              "A delivery is duplicated, skipped or no longer billable. Refresh; nothing was generated.",
          });
        const blocked = chosen.filter((c) => c.blocked.length > 0);
        if (blocked.length > 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Fix pricing first: ${blocked
              .map((b) => `${b.sub.customer.name} (${b.blocked.join(", ")})`)
              .join("; ")}`,
          });
        }

        let seq = await reserveInvoiceSequence(s.subscriptionInvoicePrefix, chosen.length, tx);
        const invoices: XeroInvoice[] = [];
        const created: {
          subscriptionId: number;
          deliveryDate: string;
          invoiceNumber: string;
          total: number;
        }[] = [];
        const ship = await shippingItem(s, tx);

        for (const row of chosen) {
          const invoiceNumber = `${s.subscriptionInvoicePrefix}${String(seq++).padStart(4, "0")}`;
          const inv = subscriptionInvoice(row.sub, row.deliveryDate, invoiceNumber, s, ship);
          invoices.push(inv);
          created.push({
            subscriptionId: row.sub.id,
            deliveryDate: row.deliveryDate,
            invoiceNumber,
            total: invoiceTotal(inv),
          });
        }

        const csv = buildXeroCsv(invoices, {
          dateFormat: s.dateFormat,
          currency: s.currency,
          brandingTheme: s.brandingTheme,
          trackingCategoryName: s.trackingCategoryName,
        });
        const fileName = `xero-subscriptions-${input.from}-to-${input.to}.csv`;
        const [batch] = await tx
          .insert(schema.invoiceBatches)
          .values({
            type: "subscriptions",
            label: `Subscriptions ${input.from} → ${input.to}`,
            fromDate: input.from,
            toDate: input.to,
            invoiceCount: invoices.length,
            lineCount: invoices.reduce((n, i) => n + i.lines.length, 0),
            total: round2(created.reduce((n, c) => n + c.total, 0)),
            fileName,
            csv,
          })
          .returning();

        for (const c of created) {
          await tx
            .insert(schema.deliveries)
            .values({ ...c, batchId: batch.id, status: "invoiced" });
        }

        return {
          batchId: batch.id,
          fileName,
          csv,
          invoiceCount: invoices.length,
          total: batch.total,
        };
      });
    }),

  /** Generate the Xero CSV for selected website orders. */
  runOrders: base.input(z.object({ orderIds: z.array(z.number()) })).handler(async ({ input }) => {
    if (input.orderIds.length === 0) {
      throw new ORPCError("BAD_REQUEST", { message: "Select at least one order." });
    }
    return db.transaction(async (tx) => {
      await syncBlankLinePrices(input.orderIds, tx);
      const s = await getSettings(tx);
      const rows = await tx
        .select({ order: schema.orders, customer: schema.customers })
        .from(schema.orders)
        .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
        .where(inArray(schema.orders.id, input.orderIds));
      if (rows.length !== input.orderIds.length)
        throw new ORPCError("CONFLICT", {
          message: "An order is duplicated or no longer exists. Refresh; nothing was generated.",
        });
      // Account code and tax type come from the matched catalog item, so each SKU lands on its
      // own revenue account in Xero. Unmatched lines have no product and fall back to settings.
      const lines = (
        await tx
          .select({ line: schema.orderLines, product: schema.products })
          .from(schema.orderLines)
          .leftJoin(schema.products, eq(schema.orderLines.productId, schema.products.id))
          .where(inArray(schema.orderLines.orderId, input.orderIds))
      ).map((r) => ({
        ...r.line,
        accountCode: r.product?.accountCode ?? null,
        taxType: r.product?.taxType ?? null,
        trackingOption: r.product?.trackingOption ?? null,
      }));

      const problems: string[] = [];
      const needPrice = new Set<string>();
      const needMatch = new Set<string>();
      for (const r of rows) {
        const reasons: string[] = [];
        if (r.order.invoiceStatus !== "pending") reasons.push("not pending / already invoiced");
        const ol = lines.filter((l) => l.orderId === r.order.id && l.status !== "ignored");
        if (ol.length === 0) reasons.push("no billable lines");
        const unmatched = ol.filter((l) => l.status === "unmatched");
        const blank = ol.filter(
          (l) => l.status !== "unmatched" && (l.unitPrice === null || l.unitPrice === 0),
        );
        if (unmatched.length > 0) {
          reasons.push(`${unmatched.length} line${unmatched.length === 1 ? "" : "s"} unmatched`);
          unmatched.forEach((l) => needMatch.add(l.rawName || l.description));
        }
        if (blank.length > 0) {
          reasons.push(`${blank.length} line${blank.length === 1 ? "" : "s"} without a price`);
          blank.forEach((l) => needPrice.add(l.sku || l.description));
        }
        if (reasons.length > 0) problems.push(`#${r.order.orderNumber}: ${reasons.join(", ")}`);
      }
      if (problems.length > 0) {
        const fix: string[] = [];
        if (needPrice.size > 0) {
          fix.push(`price these SKUs: ${[...needPrice].sort().join(", ")}`);
        }
        if (needMatch.size > 0) {
          fix.push(`match these items: ${[...needMatch].sort().join(", ")}`);
        }
        throw new ORPCError("BAD_REQUEST", {
          message: `Nothing generated — ${problems.join("; ")}.${fix.length ? ` Fix: ${fix.join("; ")}.` : ""}`,
          data: {
            orders: problems,
            skusNeedingPrice: [...needPrice].sort(),
            itemsNeedingMatch: [...needMatch].sort(),
          },
        });
      }

      let seq = await reserveInvoiceSequence(s.orderInvoicePrefix, rows.length, tx);
      const invoices: XeroInvoice[] = [];
      const assigned: { id: number; invoiceNumber: string }[] = [];
      // Every invoice in the export is issued and due on the Thursday of the export week,
      // regardless of the day each order was placed.
      const invoiceDay = thursdayOfWeek(todayIso());
      const ship = await shippingItem(s, tx);

      for (const r of rows.sort((a, b) => a.order.orderNumber.localeCompare(b.order.orderNumber))) {
        const c = r.customer;
        const invoiceNumber = r.order.invoiceNumber
          ? r.order.invoiceNumber
          : `${s.orderInvoicePrefix}${String(seq++).padStart(4, "0")}`;
        const ol = lines.filter((l) => l.orderId === r.order.id && l.status !== "ignored");
        const invLines: XeroInvoice["lines"] = ol.map((l) => ({
          itemCode: l.sku,
          description: l.description,
          quantity: l.quantity,
          unitAmount: l.unitPrice ?? 0,
          accountCode: l.accountCode || s.defaultAccountCode,
          taxType: l.taxType || s.defaultTaxType,
          trackingOption: l.trackingOption || s.defaultTrackingOption,
        }));
        if (r.order.shippingTotal > 0) {
          invLines.push({
            itemCode: ship.itemCode,
            description: `${ship.description}${r.order.shippingMethod ? ` — ${r.order.shippingMethod}` : ""}`,
            quantity: 1,
            unitAmount: r.order.shippingTotal,
            accountCode: ship.accountCode,
            taxType: ship.taxType,
            trackingOption: ship.trackingOption,
          });
        }
        if (r.order.discountTotal > 0) {
          invLines.push({
            itemCode: s.discountSku || null,
            description: s.discountDescription,
            quantity: 1,
            unitAmount: -r.order.discountTotal,
            accountCode: s.defaultAccountCode,
            taxType: s.defaultTaxType,
            trackingOption: s.discountTrackingOption || s.defaultTrackingOption,
          });
        }
        invoices.push({
          contactName: c ? customerFields(c).contactName : "Unknown customer",
          email: c?.email ?? null,
          addressLine1: c?.addressLine1 ?? null,
          addressLine2: c?.addressLine2 ?? null,
          city: c?.city ?? null,
          region: c?.region ?? null,
          postalCode: c?.postalCode ?? null,
          country: c?.country ?? null,
          invoiceNumber,
          reference: `Website order #${r.order.orderNumber}`,
          invoiceDate: invoiceDay,
          dueDate: invoiceDay,
          currency: s.currency,
          brandingTheme: s.brandingTheme,
          lines: invLines,
        });
        assigned.push({ id: r.order.id, invoiceNumber });
      }

      const csv = buildXeroCsv(invoices, {
        dateFormat: s.dateFormat,
        currency: s.currency,
        brandingTheme: s.brandingTheme,
        trackingCategoryName: s.trackingCategoryName,
      });
      const today = todayIso();
      const fileName = `xero-orders-${today}.csv`;
      const [batch] = await tx
        .insert(schema.invoiceBatches)
        .values({
          type: "orders",
          label: `Website orders (${invoices.length}) ${today}`,
          fromDate: today,
          toDate: today,
          invoiceCount: invoices.length,
          lineCount: invoices.reduce((n, i) => n + i.lines.length, 0),
          total: round2(invoices.reduce((n, i) => n + invoiceTotal(i), 0)),
          fileName,
          csv,
        })
        .returning();

      for (const a of assigned) {
        const updated = await tx
          .update(schema.orders)
          .set({ invoiceStatus: "invoiced", invoiceNumber: a.invoiceNumber, batchId: batch.id })
          .where(and(eq(schema.orders.id, a.id), eq(schema.orders.invoiceStatus, "pending")))
          .returning({ id: schema.orders.id });
        if (updated.length !== 1)
          throw new ORPCError("CONFLICT", {
            message: "An order changed during billing. Refresh; nothing was generated.",
          });
      }

      return {
        batchId: batch.id,
        fileName,
        csv,
        invoiceCount: invoices.length,
        total: batch.total,
      };
    });
  }),

  batches: base.handler(() =>
    db
      .select({
        id: schema.invoiceBatches.id,
        type: schema.invoiceBatches.type,
        label: schema.invoiceBatches.label,
        fromDate: schema.invoiceBatches.fromDate,
        toDate: schema.invoiceBatches.toDate,
        invoiceCount: schema.invoiceBatches.invoiceCount,
        lineCount: schema.invoiceBatches.lineCount,
        total: schema.invoiceBatches.total,
        fileName: schema.invoiceBatches.fileName,
        status: schema.invoiceBatches.status,
        createdAt: schema.invoiceBatches.createdAt,
      })
      .from(schema.invoiceBatches)
      .orderBy(desc(schema.invoiceBatches.id)),
  ),

  batch: base.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    const [row] = await db
      .select()
      .from(schema.invoiceBatches)
      .where(eq(schema.invoiceBatches.id, input.id));
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Batch not found" });
    return row;
  }),

  /** Undo a batch: orders return to pending, subscription deliveries become billable again. */
  voidBatch: base.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.invoiceBatches)
        .where(eq(schema.invoiceBatches.id, input.id));
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Batch not found" });
      if (row.status === "voided") return row;

      if (row.type === "orders" || row.type === "combined") {
        await tx
          .update(schema.orders)
          .set({ invoiceStatus: "pending", invoiceNumber: null, batchId: null })
          .where(eq(schema.orders.batchId, input.id));
      }
      if (row.type === "subscriptions" || row.type === "combined") {
        await tx
          .delete(schema.deliveries)
          .where(
            and(eq(schema.deliveries.batchId, input.id), eq(schema.deliveries.status, "invoiced")),
          );
      }
      const [updated] = await tx
        .update(schema.invoiceBatches)
        .set({ status: "voided" })
        .where(eq(schema.invoiceBatches.id, input.id))
        .returning();
      return updated;
    });
  }),

  removeBatch: base.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    await db.delete(schema.invoiceBatches).where(eq(schema.invoiceBatches.id, input.id));
    return { ok: true };
  }),
};
