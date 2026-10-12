import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import type { ParsedReport } from "./inventory-report";
import type { BillingDb } from "./billing-db";
import { applyRunEggStock, reverseRunEggStock } from "./layers";

export const BROILER_PENS = [
  ...[1, 2, 3].map((n) => ({ name: `Brooder ${n}`, kind: "brooder" })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ name: `Pasture ${n}`, kind: "pasture" })),
] as const;
export const BROILER_FEEDS = [
  { name: "Starter Feed", bagWeightKg: 40 },
  { name: "Grower/Finisher", bagWeightKg: 40 },
] as const;

export const roundKg = (n: number) => Math.round(n * 1000) / 1000;

/** SKUs counted in fixed-weight bags instead of loose kg; the bag weight is the row's kgPerUnit. */
export const BAGGED_STOCK_SKUS = new Set(["CHICK007", "CHICK018"]);

/** Convert a kg amount into the product's display unit (bags of kgPerUnit kg, or kg). */
export function toDisplayUnits(kg: number, unit: string, kgPerUnit: number): number {
  if (unit === "bags" && kgPerUnit > 0) return roundKg(kg / kgPerUnit);
  return roundKg(kg);
}

/** Convert a user-entered display-unit amount back to kg for storage. */
export function fromDisplayUnits(amount: number, unit: string, kgPerUnit: number): number {
  if (unit === "bags") return roundKg(amount * kgPerUnit);
  return roundKg(amount);
}

/** Invoice quantities are kg by default; explicit pack sizes convert to kg. */
export function inferKgPerUnit(description: string): number {
  const match = /(\d+(?:\.\d+)?)\s*g\b/i.exec(description);
  if (match) return roundKg(Number(match[1]) / 1000);
  return 1;
}

/** Seed the farm defaults and keep newly catalogued CHICK products available for stock setup. */
export async function ensureBroilerDefaults(database: BillingDb = db) {
  for (const pen of BROILER_PENS) {
    await database.insert(schema.broilerPens).values(pen).onConflictDoNothing();
  }
  for (const feed of BROILER_FEEDS) {
    await database.insert(schema.broilerFeedTypes).values(feed).onConflictDoNothing();
  }
  await database
    .insert(schema.broilerGas)
    .values({ id: 1, bottleSizeKg: 19, bottlesOnHand: 4, targetBottles: 4 })
    .onConflictDoNothing();
  const chickenProducts = await database
    .select()
    .from(schema.products)
    .where(like(schema.products.sku, "CHICK%"))
    .orderBy(asc(schema.products.sku));
  for (const product of chickenProducts) {
    await database
      .insert(schema.broilerStockProducts)
      .values({
        productId: product.id,
        enabled: true,
        kgPerUnit: inferKgPerUnit(product.description),
        unit: BAGGED_STOCK_SKUS.has(product.sku) ? "bags" : "kg",
      })
      .onConflictDoNothing();
  }
  // Existing catalogues predate the unit column: flip the bag-tracked SKUs once.
  const baggedIds = chickenProducts.filter((p) => BAGGED_STOCK_SKUS.has(p.sku)).map((p) => p.id);
  if (baggedIds.length) {
    await database
      .update(schema.broilerStockProducts)
      .set({ unit: "bags" })
      .where(
        and(
          inArray(schema.broilerStockProducts.productId, baggedIds),
          eq(schema.broilerStockProducts.unit, "kg"),
        ),
      );
  }
}

/** Stable content identity independent of Xero row ordering. */
export function reportFingerprint(parsed: ParsedReport): string {
  const lines = parsed.lines
    .map((line) => ({
      sku: line.sku,
      itemName: line.itemName,
      reference: line.reference,
      contact: line.contact,
      description: line.description,
      quantity: roundKg(line.quantity),
      value: roundKg(line.value),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256")
    .update(JSON.stringify({ from: parsed.periodFrom, to: parsed.periodTo, lines }))
    .digest("hex");
}

/** Reports imported before fingerprints existed get a fingerprint from their stored lines. */
export async function backfillReportFingerprints(database: BillingDb = db) {
  const runs = await database
    .select()
    .from(schema.packRuns)
    .where(isNull(schema.packRuns.reportFingerprint));
  for (const run of runs) {
    const lines = await database
      .select()
      .from(schema.packRunLines)
      .where(eq(schema.packRunLines.runId, run.id));
    const fingerprint = reportFingerprint({
      periodFrom: run.periodFrom,
      periodTo: run.periodTo,
      lines: lines.map((line) => ({
        sku: line.sku,
        itemName: line.itemName,
        date: "",
        source: "",
        reference: line.reference,
        contact: line.contact,
        description: line.description,
        quantity: line.quantity,
        value: line.value,
      })),
      skus: [],
    });
    try {
      await database
        .update(schema.packRuns)
        .set({ reportFingerprint: fingerprint })
        .where(and(eq(schema.packRuns.id, run.id), isNull(schema.packRuns.reportFingerprint)));
    } catch {
      // A second identical historical report cannot both receive the unique fingerprint.
      // Leave it null; new imports are still checked against the first fingerprinted copy.
    }
  }
}

export type StockRequirement = {
  productId: number;
  sku: string;
  description: string;
  invoiceQuantity: number;
  kgPerUnit: number;
  unit: string;
  requiredKg: number;
  currentKg: number;
  afterKg: number;
  sufficient: boolean;
};

/** Aggregate a Weekly Lists report into the kg each enabled chicken product will consume. */
export async function stockRequirementsForRun(
  runId: number,
  database: BillingDb = db,
): Promise<StockRequirement[]> {
  await ensureBroilerDefaults(database);
  const lines = await database
    .select()
    .from(schema.packRunLines)
    .where(eq(schema.packRunLines.runId, runId));
  const catalog = await database.select().from(schema.products);
  const stockRows = await database.select().from(schema.broilerStockProducts);
  const bySku = new Map(catalog.map((product) => [product.sku, product]));
  const byProduct = new Map(stockRows.map((stock) => [stock.productId, stock]));
  const requirements = new Map<number, StockRequirement>();
  for (const line of lines) {
    const product = bySku.get(line.sku);
    const stock = product ? byProduct.get(product.id) : undefined;
    if (!product || !stock?.enabled || line.quantity <= 0) continue;
    const requiredKg = roundKg(line.quantity * stock.kgPerUnit);
    if (requiredKg <= 0) continue;
    const existing = requirements.get(product.id);
    if (existing) {
      existing.invoiceQuantity = roundKg(existing.invoiceQuantity + line.quantity);
      existing.requiredKg = roundKg(existing.requiredKg + requiredKg);
      existing.afterKg = roundKg(existing.currentKg - existing.requiredKg);
      existing.sufficient = existing.afterKg >= -0.0001;
    } else {
      const currentKg = roundKg(stock.kgOnHand);
      requirements.set(product.id, {
        productId: product.id,
        sku: product.sku,
        description: product.description,
        invoiceQuantity: roundKg(line.quantity),
        kgPerUnit: stock.kgPerUnit,
        unit: stock.unit,
        requiredKg,
        currentKg,
        afterKg: roundKg(currentKg - requiredKg),
        sufficient: currentKg + 0.0001 >= requiredKg,
      });
    }
  }
  return [...requirements.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Reverse a previously applied report (chicken kg and saleable eggs). Safe before deleting its run. */
export async function reverseRunStock(
  runId: number,
  actor: string,
  database: BillingDb,
) {
  const [run] = await database
    .select()
    .from(schema.packRuns)
    .where(eq(schema.packRuns.id, runId));
  if (!run?.stockAppliedAt) return 0;
  const eggReversals = await reverseRunEggStock(runId, run.label, actor, database);
  // A run can be applied, reversed and re-applied; each application inserts fresh sale
  // rows. Only sales without a matching reversal row are still outstanding.
  const sales = await database
    .select()
    .from(schema.broilerStockMovements)
    .where(
      and(
        eq(schema.broilerStockMovements.kind, "sale"),
        eq(schema.broilerStockMovements.referenceId, runId),
      ),
    );
  const reversals = await database
    .select({ referenceId: schema.broilerStockMovements.referenceId })
    .from(schema.broilerStockMovements)
    .where(eq(schema.broilerStockMovements.kind, "sale_reversal"));
  const reversedSaleIds = new Set(reversals.map((row) => row.referenceId));
  const outstanding = sales.filter((sale) => !reversedSaleIds.has(sale.id));
  for (const sale of outstanding) {
    const restoreKg = roundKg(-sale.quantityKg);
    const [stock] = await database
      .select()
      .from(schema.broilerStockProducts)
      .where(eq(schema.broilerStockProducts.productId, sale.productId));
    if (!stock) throw new ORPCError("NOT_FOUND", { message: "Chicken stock product not found." });
    await database
      .update(schema.broilerStockProducts)
      .set({ kgOnHand: roundKg(stock.kgOnHand + restoreKg), revision: stock.revision + 1 })
      .where(eq(schema.broilerStockProducts.productId, sale.productId));
    await database.insert(schema.broilerStockMovements).values({
      productId: sale.productId,
      kind: "sale_reversal",
      quantityKg: restoreKg,
      referenceKey: `run-reversal:${sale.id}`,
      referenceId: sale.id,
      actor,
      note: `Reversed Weekly List ${run.label}`,
    });
  }
  await database
    .update(schema.packRuns)
    .set({ stockAppliedAt: null, stockAppliedBy: null })
    .where(eq(schema.packRuns.id, runId));
  return outstanding.length + eggReversals;
}

export async function activeEmployee(employeeId: number, database: BillingDb = db) {
  const [employee] = await database
    .select()
    .from(schema.farmEmployees)
    .where(and(eq(schema.farmEmployees.id, employeeId), eq(schema.farmEmployees.active, true)));
  if (!employee) {
    throw new ORPCError("BAD_REQUEST", { message: "Choose an active employee name." });
  }
  return employee;
}

export async function batchOrThrow(batchId: number, database: BillingDb = db) {
  const [batch] = await database
    .select()
    .from(schema.broilerBatches)
    .where(eq(schema.broilerBatches.id, batchId));
  if (!batch) throw new ORPCError("NOT_FOUND", { message: "Broiler batch not found." });
  return batch;
}

export async function penOrThrow(penId: number, database: BillingDb = db) {
  const [pen] = await database
    .select()
    .from(schema.broilerPens)
    .where(eq(schema.broilerPens.id, penId));
  if (!pen || !pen.active) {
    throw new ORPCError("BAD_REQUEST", { message: "Choose an active pen." });
  }
  return pen;
}

export async function penBalance(batchId: number, penId: number, database: BillingDb = db) {
  const [row] = await database
    .select()
    .from(schema.broilerPenStocks)
    .where(
      and(
        eq(schema.broilerPenStocks.batchId, batchId),
        eq(schema.broilerPenStocks.penId, penId),
      ),
    );
  return row?.birdCount ?? 0;
}

export async function changePenBalance(
  batchId: number,
  penId: number,
  delta: number,
  database: BillingDb,
) {
  if (delta < 0) {
    const [updated] = await database
      .update(schema.broilerPenStocks)
      .set({ birdCount: sql`${schema.broilerPenStocks.birdCount} + ${delta}` })
      .where(
        and(
          eq(schema.broilerPenStocks.batchId, batchId),
          eq(schema.broilerPenStocks.penId, penId),
          gte(schema.broilerPenStocks.birdCount, -delta),
        ),
      )
      .returning();
    if (!updated || updated.birdCount < 0) {
      throw new ORPCError("CONFLICT", {
        message: "The pen count changed on another device. Refresh and try again.",
      });
    }
    return;
  }
  const [existing] = await database
    .select()
    .from(schema.broilerPenStocks)
    .where(
      and(
        eq(schema.broilerPenStocks.batchId, batchId),
        eq(schema.broilerPenStocks.penId, penId),
      ),
    );
  if (existing) {
    await database
      .update(schema.broilerPenStocks)
      .set({ birdCount: sql`${schema.broilerPenStocks.birdCount} + ${delta}` })
      .where(eq(schema.broilerPenStocks.id, existing.id));
  } else if (delta > 0) {
    await database
      .insert(schema.broilerPenStocks)
      .values({ batchId, penId, birdCount: delta })
      .onConflictDoNothing();
  }
}

export function assertUniquePens(allocations: { penId: number }[]) {
  if (new Set(allocations.map((a) => a.penId)).size !== allocations.length) {
    throw new ORPCError("BAD_REQUEST", { message: "Use each pen only once." });
  }
}
