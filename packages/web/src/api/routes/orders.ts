import { ORPCError } from "@orpc/server";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { manager as base } from "../middleware/manager";
import { db } from "../database";
import * as schema from "../database/schema";
import { ingestOrders } from "../lib/ingest";
import { syncBlankLinePrices } from "../lib/pricing";
import { parseWooOrdersCsv } from "../lib/woo";

export type OrderWithLines = Awaited<ReturnType<typeof loadOrders>>[number];

async function loadOrders(statuses?: string[]) {
  await syncBlankLinePrices();

  const rows = await db
    .select({
      order: schema.orders,
      customer: schema.customers,
    })
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .orderBy(desc(schema.orders.orderDate), desc(schema.orders.id));

  const filtered = statuses?.length
    ? rows.filter((r) => statuses.includes(r.order.invoiceStatus))
    : rows;
  const ids = filtered.map((r) => r.order.id);
  const lines = ids.length
    ? await db.select().from(schema.orderLines).where(inArray(schema.orderLines.orderId, ids))
    : [];

  return filtered.map((r) => {
    const orderLines = lines.filter((l) => l.orderId === r.order.id);
    const computed = orderLines
      .filter((l) => l.status !== "ignored")
      .reduce((sum, l) => sum + l.quantity * (l.unitPrice ?? 0), 0);
    const expectedTotal = computed + r.order.shippingTotal - r.order.discountTotal;
    return {
      ...r.order,
      customer: r.customer,
      lines: orderLines,
      unmatchedCount: orderLines.filter((l) => l.status === "unmatched").length,
      missingPriceCount: orderLines.filter(
        (l) => l.status === "matched" && (l.unitPrice === null || l.unitPrice === 0),
      ).length,
      computedTotal: Math.round(expectedTotal * 100) / 100,
      totalMismatch: Math.abs(expectedTotal - r.order.orderTotal) > 0.01,
    };
  });
}

export const orders = {
  list: base
    .input(z.object({ statuses: z.array(z.string()).optional() }).optional())
    .handler(({ input }) => loadOrders(input?.statuses)),

  stats: base.handler(async () => {
    const rows = await loadOrders();
    return {
      pending: rows.filter((o) => o.invoiceStatus === "pending").length,
      invoiced: rows.filter((o) => o.invoiceStatus === "invoiced").length,
      blocked: rows.filter(
        (o) => o.invoiceStatus === "pending" && (o.unmatchedCount > 0 || o.missingPriceCount > 0),
      ).length,
      pendingValue:
        Math.round(
          rows
            .filter((o) => o.invoiceStatus === "pending")
            .reduce((sum, o) => sum + o.orderTotal, 0) * 100,
        ) / 100,
    };
  }),

  /** Upload a WooCommerce order-export CSV. */
  importCsv: base.input(z.object({ csv: z.string() })).handler(async ({ input }) => {
    const parsed = parseWooOrdersCsv(input.csv);
    if (parsed.length === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "No orders found — expected a WooCommerce order export with an 'Items' column.",
      });
    }
    return ingestOrders(parsed, "website");
  }),

  /** Map an unmatched line to a catalog product, optionally remembering the name as an alias. */
  resolveLine: base
    .input(
      z.object({
        lineId: z.number(),
        productId: z.number(),
        rememberAlias: z.boolean().default(true),
      }),
    )
    .handler(async ({ input }) => {
      const [line] = await db
        .select()
        .from(schema.orderLines)
        .where(eq(schema.orderLines.id, input.lineId));
      if (!line) throw new ORPCError("NOT_FOUND", { message: "Line not found" });
      const [product] = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, input.productId));
      if (!product) throw new ORPCError("NOT_FOUND", { message: "Product not found" });

      await db
        .update(schema.orderLines)
        .set({
          productId: product.id,
          sku: product.sku,
          description: product.description,
          unitPrice: product.unitPrice,
          status: "matched",
        })
        .where(eq(schema.orderLines.id, line.id));

      if (input.rememberAlias && line.rawName) {
        const [alias] = await db
          .select()
          .from(schema.productAliases)
          .where(eq(schema.productAliases.aliasText, line.rawName));
        if (!alias) {
          await db
            .insert(schema.productAliases)
            .values({ aliasText: line.rawName, productId: product.id });
        }
        // apply to every other unmatched line with the same raw name
        const others = await db
          .select()
          .from(schema.orderLines)
          .where(eq(schema.orderLines.rawName, line.rawName));
        for (const o of others) {
          if (o.id === line.id || o.status === "matched") continue;
          await db
            .update(schema.orderLines)
            .set({
              productId: product.id,
              sku: product.sku,
              description: product.description,
              unitPrice: product.unitPrice,
              status: "matched",
            })
            .where(eq(schema.orderLines.id, o.id));
        }
      }
      return { ok: true };
    }),

  updateLine: base
    .input(
      z.object({
        lineId: z.number(),
        quantity: z.number().optional(),
        unitPrice: z.number().nullable().optional(),
        description: z.string().optional(),
        status: z.enum(["matched", "unmatched", "ignored"]).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { lineId, ...values } = input;
      const [row] = await db
        .update(schema.orderLines)
        .set(values)
        .where(eq(schema.orderLines.id, lineId))
        .returning();
      return row;
    }),

  /** Refresh line prices/descriptions from the catalog (after updating prices). */
  syncPrices: base
    .input(z.object({ orderIds: z.array(z.number()).optional() }).optional())
    .handler(async ({ input }) => {
      const lines = await db
        .select()
        .from(schema.orderLines)
        .innerJoin(schema.orders, eq(schema.orderLines.orderId, schema.orders.id))
        .where(eq(schema.orders.invoiceStatus, "pending"));
      const productRows = await db.select().from(schema.products);
      let updated = 0;
      for (const { order_lines: line } of lines) {
        if (input?.orderIds?.length && !input.orderIds.includes(line.orderId)) continue;
        if (!line.productId) continue;
        const product = productRows.find((p) => p.id === line.productId);
        if (!product) continue;
        if (product.unitPrice !== line.unitPrice) {
          await db
            .update(schema.orderLines)
            .set({ unitPrice: product.unitPrice })
            .where(eq(schema.orderLines.id, line.id));
          updated++;
        }
      }
      return { updated };
    }),

  setStatus: base
    .input(
      z.object({
        orderIds: z.array(z.number()),
        invoiceStatus: z.enum(["pending", "invoiced", "ignored"]),
      }),
    )
    .handler(async ({ input }) => {
      if (input.orderIds.length === 0) return { updated: 0 };
      await db
        .update(schema.orders)
        .set({ invoiceStatus: input.invoiceStatus })
        .where(inArray(schema.orders.id, input.orderIds));
      return { updated: input.orderIds.length };
    }),

  remove: base.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    await db.delete(schema.orderLines).where(eq(schema.orderLines.orderId, input.id));
    await db.delete(schema.orders).where(eq(schema.orders.id, input.id));
    return { ok: true };
  }),

  unmatchedLines: base.handler(async () => {
    const rows = await db
      .select({ line: schema.orderLines, order: schema.orders })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orderLines.orderId, schema.orders.id))
      .where(eq(schema.orderLines.status, "unmatched"));
    return rows.map((r) => ({ ...r.line, orderNumber: r.order.orderNumber }));
  }),

  count: base.handler(async () => {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.orders);
    return { count };
  }),
};
