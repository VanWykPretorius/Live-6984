import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import type { BillingDb } from "./billing-db";

/**
 * Order lines snapshot their price at import time, so a SKU that was auto-created without
 * one leaves the line blank and the order un-invoiceable. Whenever the catalog does have a
 * price, copy it onto the blank lines of orders that have not been invoiced yet.
 *
 * Lines that already carry a price are never touched — that is the price the order was
 * placed at, and it must survive later catalog changes.
 */
export async function syncBlankLinePrices(
  orderIds?: number[],
  database: BillingDb = db,
): Promise<number> {
  const pending = await database
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(eq(schema.orders.invoiceStatus, "pending"));
  const ids = orderIds ? pending.filter((o) => orderIds.includes(o.id)) : pending;
  if (ids.length === 0) return 0;

  const blanks = await database
    .select({ id: schema.orderLines.id, price: schema.products.unitPrice })
    .from(schema.orderLines)
    .innerJoin(schema.products, eq(schema.orderLines.productId, schema.products.id))
    .where(
      and(
        isNull(schema.orderLines.unitPrice),
        isNotNull(schema.products.unitPrice),
        inArray(
          schema.orderLines.orderId,
          ids.map((o) => o.id),
        ),
      ),
    );

  for (const b of blanks) {
    await database
      .update(schema.orderLines)
      .set({ unitPrice: b.price })
      .where(eq(schema.orderLines.id, b.id));
  }
  return blanks.length;
}
