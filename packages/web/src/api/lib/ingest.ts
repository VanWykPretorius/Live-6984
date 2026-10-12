import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { getSettings } from "./settings";
import type { ParsedOrder } from "./woo";

export type IngestResult = {
  imported: number;
  skipped: number;
  skippedOrders: string[];
  unmatchedLines: number;
  productsCreated: string[];
};

async function upsertCustomer(c: ParsedOrder["customer"]): Promise<number> {
  const name = c.name?.trim() || c.company?.trim() || c.email || "Unknown customer";
  const email = c.email?.trim() || null;

  const existing = email
    ? (await db.select().from(schema.customers).where(eq(schema.customers.email, email)))[0]
    : (await db.select().from(schema.customers).where(eq(schema.customers.name, name)))[0];

  const values = {
    name,
    company: c.company || null,
    email,
    phone: c.phone || null,
    addressLine1: c.addressLine1 || null,
    addressLine2: c.addressLine2 || null,
    city: c.city || null,
    region: c.region || null,
    postalCode: c.postalCode || null,
    country: c.country || null,
  };

  if (existing) {
    await db.update(schema.customers).set(values).where(eq(schema.customers.id, existing.id));
    return existing.id;
  }
  const [created] = await db.insert(schema.customers).values(values).returning();
  return created.id;
}

/**
 * Import parsed orders. Existing order numbers are skipped (never re-imported), unknown
 * SKUs are auto-created as draft catalog items that need a price, and lines without a SKU
 * are matched through the alias table or flagged for manual mapping.
 */
export async function ingestOrders(
  parsed: ParsedOrder[],
  source: "website" | "api" | "manual",
): Promise<IngestResult> {
  const settings = await getSettings();
  const result: IngestResult = {
    imported: 0,
    skipped: 0,
    skippedOrders: [],
    unmatchedLines: 0,
    productsCreated: [],
  };

  for (const order of parsed) {
    const [existing] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.orderNumber, order.orderNumber));
    if (existing) {
      result.skipped++;
      result.skippedOrders.push(order.orderNumber);
      continue;
    }

    const customerId = await upsertCustomer(order.customer);
    const [created] = await db
      .insert(schema.orders)
      .values({
        orderNumber: order.orderNumber,
        source,
        customerId,
        orderDate: order.orderDate,
        websiteStatus: order.websiteStatus || null,
        shippingMethod: order.shippingMethod || null,
        customerNote: order.customerNote || null,
        discountTotal: order.discountTotal,
        shippingTotal: order.shippingTotal,
        taxTotal: order.taxTotal,
        orderTotal: order.orderTotal,
        rawItems: order.rawItems,
      })
      .returning();

    for (const item of order.items) {
      let product: typeof schema.products.$inferSelect | undefined;

      if (item.sku) {
        [product] = await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.sku, item.sku));
        if (!product) {
          [product] = await db
            .insert(schema.products)
            .values({
              sku: item.sku,
              description: item.rawName || item.sku,
              unitPrice: null,
              accountCode: settings.defaultAccountCode,
              taxType: settings.defaultTaxType,
              trackingOption: settings.defaultTrackingOption,
            })
            .returning();
          result.productsCreated.push(item.sku);
        }
      }

      if (!product && item.rawName) {
        const [alias] = await db
          .select()
          .from(schema.productAliases)
          .where(eq(schema.productAliases.aliasText, item.rawName));
        if (alias) {
          [product] = await db
            .select()
            .from(schema.products)
            .where(eq(schema.products.id, alias.productId));
        }
      }

      if (!product && item.rawName) {
        const all = await db.select().from(schema.products);
        product = all.find(
          (p) => p.description.trim().toLowerCase() === item.rawName.trim().toLowerCase(),
        );
      }

      const matched = Boolean(product);
      if (!matched) result.unmatchedLines++;

      await db.insert(schema.orderLines).values({
        orderId: created.id,
        rawText: item.rawText,
        rawName: item.rawName,
        sku: product?.sku ?? item.sku ?? null,
        description: product?.description ?? item.rawName,
        quantity: item.quantity,
        unitPrice: product?.unitPrice ?? null,
        productId: product?.id ?? null,
        status: matched ? "matched" : "unmatched",
      });
    }

    result.imported++;
  }

  return result;
}
