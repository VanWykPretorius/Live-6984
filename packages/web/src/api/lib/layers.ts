import { ORPCError } from "@orpc/server";
import { and, asc, eq, gte, like, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import type { BillingDb } from "./billing-db";

export const EGG_MOBILES = [1, 2, 3].map((n) => ({ name: `Egg mobile ${n}` }));
export const LAYER_FEED = { name: "Layer Feed", bagWeightKg: 40 } as const;

/** "30 x Pastured Eggs" → 30 eggs per invoiced unit; unparseable packs count as one egg. */
export function inferEggsPerUnit(description: string): number {
  const match = /(\d+)\s*x/i.exec(description);
  const count = match ? Number(match[1]) : 1;
  return Number.isFinite(count) && count > 0 ? Math.min(count, 1000) : 1;
}

/** Seed the farm defaults and keep newly catalogued EGG products available for stock setup. */
export async function ensureLayerDefaults(database: BillingDb = db) {
  for (const mobile of EGG_MOBILES) {
    await database.insert(schema.eggMobiles).values(mobile).onConflictDoNothing();
  }
  await database
    .insert(schema.eggStock)
    .values({ id: 1, eggsOnHand: 0 })
    .onConflictDoNothing();
  await database.insert(schema.layerFeedTypes).values(LAYER_FEED).onConflictDoNothing();
  const eggProducts = await database
    .select()
    .from(schema.products)
    .where(like(schema.products.sku, "EGG%"))
    .orderBy(asc(schema.products.sku));
  for (const product of eggProducts) {
    await database
      .insert(schema.eggStockProducts)
      .values({ productId: product.id, enabled: true, eggsPerUnit: inferEggsPerUnit(product.description) })
      .onConflictDoNothing();
  }
}

export async function eggStockRegister(database: BillingDb = db) {
  await ensureLayerDefaults(database);
  const [stock] = await database.select().from(schema.eggStock).where(eq(schema.eggStock.id, 1));
  if (!stock) throw new ORPCError("NOT_FOUND", { message: "Egg stock register not found." });
  return stock;
}

export async function mobileOrThrow(mobileId: number, database: BillingDb = db) {
  const [mobile] = await database
    .select()
    .from(schema.eggMobiles)
    .where(eq(schema.eggMobiles.id, mobileId));
  if (!mobile || !mobile.active) {
    throw new ORPCError("BAD_REQUEST", { message: "Choose an active egg mobile." });
  }
  return mobile;
}

/**
 * Change the loose-egg pool and write its ledger row. The update is guarded so
 * concurrent logging and invoicing can never overdraw or lose a revision race.
 */
export async function changeEggStock(
  database: BillingDb,
  delta: number,
  movement: typeof schema.eggStockMovements.$inferInsert,
  expectedRevision?: number,
) {
  const stock = await eggStockRegister(database);
  if (expectedRevision !== undefined && stock.revision !== expectedRevision) {
    throw new ORPCError("CONFLICT", {
      message: "The egg stock changed on another device. Refresh and try again.",
    });
  }
  const [updated] = await database
    .update(schema.eggStock)
    .set({ eggsOnHand: stock.eggsOnHand + delta, revision: stock.revision + 1 })
    .where(
      and(
        eq(schema.eggStock.id, 1),
        eq(schema.eggStock.revision, stock.revision),
        ...(delta < 0 ? [gte(schema.eggStock.eggsOnHand, -delta)] : []),
      ),
    )
    .returning();
  if (!updated) {
    throw new ORPCError("CONFLICT", {
      message:
        delta < 0
          ? "Not enough saleable eggs on hand. Refresh and try again."
          : "The egg stock changed on another device. Refresh and try again.",
    });
  }
  await database.insert(schema.eggStockMovements).values(movement);
  return updated;
}

/** Change a mobile's bird count; decrements are guarded so counts never go negative. */
export async function changeMobileBirds(
  database: BillingDb,
  mobileId: number,
  delta: number,
) {
  const [updated] = await database
    .update(schema.eggMobiles)
    .set({ birdCount: sql`${schema.eggMobiles.birdCount} + ${delta}` })
    .where(
      and(
        eq(schema.eggMobiles.id, mobileId),
        ...(delta < 0 ? [gte(schema.eggMobiles.birdCount, -delta)] : []),
      ),
    )
    .returning();
  if (!updated) {
    throw new ORPCError("CONFLICT", {
      message: "The bird count changed on another device. Refresh and try again.",
    });
  }
  return updated;
}

export type EggRequirement = {
  productId: number;
  sku: string;
  description: string;
  invoiceQuantity: number;
  eggsPerUnit: number;
  requiredEggs: number;
};

/** Aggregate a Weekly Lists report into the loose eggs each enabled EGG product will consume. */
export async function eggRequirementsForRun(
  runId: number,
  database: BillingDb = db,
): Promise<EggRequirement[]> {
  await ensureLayerDefaults(database);
  const lines = await database
    .select()
    .from(schema.packRunLines)
    .where(eq(schema.packRunLines.runId, runId));
  const catalog = await database.select().from(schema.products);
  const stockRows = await database.select().from(schema.eggStockProducts);
  const bySku = new Map(catalog.map((product) => [product.sku, product]));
  const byProduct = new Map(stockRows.map((stock) => [stock.productId, stock]));
  const requirements = new Map<number, EggRequirement>();
  for (const line of lines) {
    const product = bySku.get(line.sku);
    const stock = product ? byProduct.get(product.id) : undefined;
    if (!product || !stock?.enabled || line.quantity <= 0) continue;
    const requiredEggs = Math.round(line.quantity * stock.eggsPerUnit);
    if (requiredEggs <= 0) continue;
    const existing = requirements.get(product.id);
    if (existing) {
      existing.invoiceQuantity += line.quantity;
      existing.requiredEggs += requiredEggs;
    } else {
      requirements.set(product.id, {
        productId: product.id,
        sku: product.sku,
        description: product.description,
        invoiceQuantity: line.quantity,
        eggsPerUnit: stock.eggsPerUnit,
        requiredEggs,
      });
    }
  }
  return [...requirements.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

/**
 * Apply a Weekly Lists report to the loose-egg pool. Runs inside the caller's
 * transaction together with the chicken deduction so both succeed or neither does.
 */
export async function applyRunEggStock(
  runId: number,
  runLabel: string,
  actor: string,
  database: BillingDb,
) {
  const requirements = await eggRequirementsForRun(runId, database);
  const totalEggs = requirements.reduce((sum, row) => sum + row.requiredEggs, 0);
  if (totalEggs <= 0) return { products: 0, eggs: 0 };
  const stock = await eggStockRegister(database);
  if (stock.eggsOnHand < totalEggs) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Not enough saleable eggs: the report needs ${totalEggs} but only ${stock.eggsOnHand} are on hand.`,
    });
  }
  const detail = requirements
    .map((row) => `${row.sku} × ${row.invoiceQuantity} (${row.requiredEggs} eggs)`)
    .join("; ");
  const updated = await changeEggStock(database, -totalEggs, {
    kind: "sale",
    quantityEggs: -totalEggs,
    referenceKey: `run:${runId}:${crypto.randomUUID()}`,
    referenceId: runId,
    actor,
    note: `Weekly List ${runLabel}: ${detail}`,
  });
  return { products: requirements.length, eggs: totalEggs, eggsOnHand: updated.eggsOnHand };
}

/**
 * Reverse the egg side of a previously applied report. Only sale rows without a
 * matching reversal are still outstanding, so re-apply/reverse cycles stay exact.
 */
export async function reverseRunEggStock(
  runId: number,
  runLabel: string,
  actor: string,
  database: BillingDb,
) {
  const sales = await database
    .select()
    .from(schema.eggStockMovements)
    .where(
      and(
        eq(schema.eggStockMovements.kind, "sale"),
        eq(schema.eggStockMovements.referenceId, runId),
      ),
    );
  const reversals = await database
    .select({ referenceId: schema.eggStockMovements.referenceId })
    .from(schema.eggStockMovements)
    .where(eq(schema.eggStockMovements.kind, "sale_reversal"));
  const reversedSaleIds = new Set(reversals.map((row) => row.referenceId));
  const outstanding = sales.filter((sale) => !reversedSaleIds.has(sale.id));
  for (const sale of outstanding) {
    await changeEggStock(database, -sale.quantityEggs, {
      kind: "sale_reversal",
      quantityEggs: -sale.quantityEggs,
      referenceKey: `run-reversal:${sale.id}`,
      referenceId: sale.id,
      actor,
      note: `Reversed Weekly List ${runLabel}`,
    });
  }
  return outstanding.length;
}
