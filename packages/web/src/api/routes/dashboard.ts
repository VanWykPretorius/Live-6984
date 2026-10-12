import { desc, eq, sql } from "drizzle-orm";
import { manager as base } from "../middleware/manager";
import { db } from "../database";
import * as schema from "../database/schema";
import { deliveryDatesInRange, todayIso, weekRange } from "../lib/schedule";
import { loadSubscriptions } from "./subscriptions";

export const dashboard = {
  summary: base.handler(async () => {
    const today = todayIso();
    const week = weekRange(today);

    const orderRows = await db.select().from(schema.orders);
    const lines = await db.select().from(schema.orderLines);
    const pending = orderRows.filter((o) => o.invoiceStatus === "pending");
    const pendingIds = new Set(pending.map((o) => o.id));
    const pendingLines = lines.filter((l) => pendingIds.has(l.orderId));

    const products = await db.select().from(schema.products);
    const subs = await loadSubscriptions();
    const billed = await db.select().from(schema.deliveries);

    const dueThisWeek = subs.flatMap((s) =>
      deliveryDatesInRange(s, week.from, week.to)
        .filter(
          (d) => !billed.some((b) => b.subscriptionId === s.id && b.deliveryDate === d),
        )
        .map((d) => ({
          subscriptionId: s.id,
          customerName: s.customer.name,
          deliveryDate: d,
          total: s.perDelivery,
        })),
    );

    const [lastBatch] = await db
      .select()
      .from(schema.invoiceBatches)
      .where(eq(schema.invoiceBatches.status, "active"))
      .orderBy(desc(schema.invoiceBatches.id))
      .limit(1);

    const [{ count: customerCount }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.customers);

    return {
      today,
      week,
      orders: {
        pending: pending.length,
        pendingValue:
          Math.round(pending.reduce((sum, o) => sum + o.orderTotal, 0) * 100) / 100,
        invoiced: orderRows.filter((o) => o.invoiceStatus === "invoiced").length,
        unmatchedLines: pendingLines.filter((l) => l.status === "unmatched").length,
        missingPriceLines: pendingLines.filter(
          (l) => l.status === "matched" && (l.unitPrice === null || l.unitPrice === 0),
        ).length,
      },
      catalog: {
        total: products.length,
        missingPrice: products.filter((p) => p.unitPrice === null || p.unitPrice === 0).length,
      },
      subscriptions: {
        active: subs.filter((s) => s.status === "active").length,
        paused: subs.filter((s) => s.status === "paused").length,
        cancelled: subs.filter((s) => s.status === "cancelled").length,
        weeklyValue:
          Math.round(
            subs
              .filter((s) => s.status === "active")
              .reduce(
                (sum, s) => sum + s.perDelivery / (s.frequency === "biweekly" ? 2 : 1),
                0,
              ) * 100,
          ) / 100,
      },
      dueThisWeek: dueThisWeek.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)),
      dueThisWeekValue:
        Math.round(dueThisWeek.reduce((sum, d) => sum + d.total, 0) * 100) / 100,
      customerCount,
      lastBatch: lastBatch
        ? {
            id: lastBatch.id,
            label: lastBatch.label,
            type: lastBatch.type,
            invoiceCount: lastBatch.invoiceCount,
            total: lastBatch.total,
            fileName: lastBatch.fileName,
            createdAt: lastBatch.createdAt,
          }
        : null,
    };
  }),
};
