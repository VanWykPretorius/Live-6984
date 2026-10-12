import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { manager as base } from "../middleware/manager";
import { db } from "../database";
import * as schema from "../database/schema";
import { deliveryDatesInRange, nextDeliveryDate, pauseHasExpired, todayIso } from "../lib/schedule";
import { getSettings } from "../lib/settings";
import type { BillingDb } from "../lib/billing-db";
import { addDays, round2 } from "../lib/xero";

const addonInput = z.object({
  productId: z.number(),
  quantity: z.number().min(0.01),
  unitPrice: z.number().nullable().optional(),
});

/**
 * Field shapes with no defaults attached. Defaults are applied only on create — on update
 * a missing key has to mean "leave it alone", otherwise editing one field would silently
 * reset add-ons, shipping and quantity.
 */
const subscriptionFields = z.object({
  customerId: z.number(),
  boxProductId: z.number().nullable().optional(),
  boxPrice: z.number(),
  boxQuantity: z.number().min(0.01),
  frequency: z.enum(["weekly", "biweekly"]),
  startDate: z.string(),
  status: z.enum(["active", "paused", "cancelled"]),
  pauseFrom: z.string().nullable().optional(),
  pauseTo: z.string().nullable().optional(),
  includeShipping: z.boolean(),
  shippingAmount: z.number(),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  addons: z.array(addonInput),
});

const subscriptionInput = subscriptionFields.extend({
  boxQuantity: z.number().min(0.01).default(1),
  status: z.enum(["active", "paused", "cancelled"]).default("active"),
  includeShipping: z.boolean().default(false),
  shippingAmount: z.number().default(0),
  addons: z.array(addonInput).default([]),
});

/** Only the keys the caller actually sent are written. */
const subscriptionPatch = subscriptionFields.partial().extend({ id: z.number() });

export async function loadSubscriptions(database: BillingDb = db) {
  await reactivateExpiredPauses(database);

  const rows = await database
    .select({ sub: schema.subscriptions, customer: schema.customers })
    .from(schema.subscriptions)
    .innerJoin(schema.customers, eq(schema.subscriptions.customerId, schema.customers.id))
    .orderBy(asc(schema.customers.name));

  const ids = rows.map((r) => r.sub.id);
  const addons = ids.length
    ? await database
        .select({ addon: schema.subscriptionAddons, product: schema.products })
        .from(schema.subscriptionAddons)
        .leftJoin(schema.products, eq(schema.subscriptionAddons.productId, schema.products.id))
        .where(inArray(schema.subscriptionAddons.subscriptionId, ids))
    : [];
  const boxProducts = await database.select().from(schema.products);
  const billed = ids.length
    ? await database
        .select()
        .from(schema.deliveries)
        .where(inArray(schema.deliveries.subscriptionId, ids))
    : [];

  const today = todayIso();
  return rows.map((r) => {
    const subAddons = addons
      .filter((a) => a.addon.subscriptionId === r.sub.id)
      .map((a) => ({
        ...a.addon,
        sku: a.product?.sku ?? "",
        description: a.product?.description ?? "",
        accountCode: a.product?.accountCode ?? null,
        taxType: a.product?.taxType ?? null,
        trackingOption: a.product?.trackingOption ?? null,
        catalogPrice: a.product?.unitPrice ?? null,
        effectivePrice: a.addon.unitPrice ?? a.product?.unitPrice ?? null,
      }));
    const box = boxProducts.find((p) => p.id === r.sub.boxProductId) ?? null;
    const addonTotal = subAddons.reduce((s, a) => s + a.quantity * (a.effectivePrice ?? 0), 0);
    const perDelivery = round2(
      r.sub.boxPrice * r.sub.boxQuantity +
        addonTotal +
        (r.sub.includeShipping ? r.sub.shippingAmount : 0),
    );
    const subBilled = billed.filter((d) => d.subscriptionId === r.sub.id);
    return {
      ...r.sub,
      customer: r.customer,
      box,
      addons: subAddons,
      perDelivery,
      nextDelivery: nextDeliveryDate(r.sub, today),
      deliveriesBilled: subBilled.length,
      lastBilledDate:
        subBilled
          .map((d) => d.deliveryDate)
          .sort()
          .at(-1) ?? null,
      upcoming: deliveryDatesInRange(r.sub, today, addDays(today, 42)).slice(0, 4),
    };
  });
}

/**
 * A pause set for a date range that has now passed is over — the cadence is already
 * billing again, so flip those rows back to active instead of reporting them as paused.
 */
export async function reactivateExpiredPauses(database: BillingDb = db): Promise<number> {
  const today = todayIso();
  const paused = await database
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.status, "paused"));
  const stale = paused.filter((s) => pauseHasExpired(s, today));
  for (const s of stale) {
    await database
      .update(schema.subscriptions)
      .set({ status: "active", pauseFrom: null, pauseTo: null })
      .where(eq(schema.subscriptions.id, s.id));
  }
  return stale.length;
}

async function replaceAddons(subscriptionId: number, addons: z.infer<typeof addonInput>[]) {
  await db
    .delete(schema.subscriptionAddons)
    .where(eq(schema.subscriptionAddons.subscriptionId, subscriptionId));
  for (const a of addons) {
    await db.insert(schema.subscriptionAddons).values({
      subscriptionId,
      productId: a.productId,
      quantity: a.quantity,
      unitPrice: a.unitPrice ?? null,
    });
  }
}

export const subscriptions = {
  list: base.handler(() => loadSubscriptions()),

  stats: base.handler(async () => {
    const rows = await loadSubscriptions();
    return {
      active: rows.filter((s) => s.status === "active").length,
      paused: rows.filter((s) => s.status === "paused").length,
      cancelled: rows.filter((s) => s.status === "cancelled").length,
      weeklyValue:
        Math.round(
          rows
            .filter((s) => s.status === "active")
            .reduce((sum, s) => sum + s.perDelivery / (s.frequency === "biweekly" ? 2 : 1), 0) *
            100,
        ) / 100,
    };
  }),

  create: base.input(subscriptionInput).handler(async ({ input }) => {
    const { addons, ...values } = input;
    const s = await getSettings();
    let boxProductId = values.boxProductId ?? null;
    if (!boxProductId && s.defaultBoxSku) {
      const [box] = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.sku, s.defaultBoxSku.toUpperCase()));
      boxProductId = box?.id ?? null;
    }
    const [row] = await db
      .insert(schema.subscriptions)
      .values({ ...values, boxProductId })
      .returning();
    await replaceAddons(row.id, addons);
    return row;
  }),

  update: base.input(subscriptionPatch).handler(async ({ input }) => {
    const { id, addons, ...values } = input;
    const patch = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    const [row] = Object.keys(patch).length
      ? await db
          .update(schema.subscriptions)
          .set(patch)
          .where(eq(schema.subscriptions.id, id))
          .returning()
      : await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id));
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Subscription not found" });
    if (addons) await replaceAddons(id, addons);
    return row;
  }),

  pause: base
    .input(
      z.object({
        id: z.number(),
        pauseFrom: z.string().nullable(),
        pauseTo: z.string().nullable(),
      }),
    )
    .handler(async ({ input }) => {
      const [row] = await db
        .update(schema.subscriptions)
        .set({ status: "paused", pauseFrom: input.pauseFrom, pauseTo: input.pauseTo })
        .where(eq(schema.subscriptions.id, input.id))
        .returning();
      return row;
    }),

  resume: base.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    const [row] = await db
      .update(schema.subscriptions)
      .set({ status: "active", pauseFrom: null, pauseTo: null })
      .where(eq(schema.subscriptions.id, input.id))
      .returning();
    return row;
  }),

  cancel: base.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    const [row] = await db
      .update(schema.subscriptions)
      .set({ status: "cancelled" })
      .where(eq(schema.subscriptions.id, input.id))
      .returning();
    return row;
  }),

  remove: base.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    await db
      .delete(schema.subscriptionAddons)
      .where(eq(schema.subscriptionAddons.subscriptionId, input.id));
    await db.delete(schema.deliveries).where(eq(schema.deliveries.subscriptionId, input.id));
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.id, input.id));
    return { ok: true };
  }),

  /** Billed delivery history for one subscription. */
  deliveries: base
    .input(z.object({ id: z.number() }))
    .handler(({ input }) =>
      db
        .select()
        .from(schema.deliveries)
        .where(eq(schema.deliveries.subscriptionId, input.id))
        .orderBy(asc(schema.deliveries.deliveryDate)),
    ),

  /** Mark a delivery as skipped so the billing run ignores it (without pausing). */
  skipDelivery: base
    .input(z.object({ subscriptionId: z.number(), deliveryDate: z.string() }))
    .handler(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(schema.deliveries)
        .where(
          and(
            eq(schema.deliveries.subscriptionId, input.subscriptionId),
            eq(schema.deliveries.deliveryDate, input.deliveryDate),
          ),
        );
      if (existing) return existing;
      const [row] = await db
        .insert(schema.deliveries)
        .values({
          subscriptionId: input.subscriptionId,
          deliveryDate: input.deliveryDate,
          invoiceNumber: "",
          total: 0,
          status: "skipped",
        })
        .returning();
      return row;
    }),

  unskipDelivery: base.input(z.object({ deliveryId: z.number() })).handler(async ({ input }) => {
    await db.delete(schema.deliveries).where(eq(schema.deliveries.id, input.deliveryId));
    return { ok: true };
  }),
};
