import { ORPCError } from "@orpc/server";
import { asc, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { base } from "../__core/app";
import { db } from "../database";
import * as schema from "../database/schema";
import { toCsv } from "../lib/csv";
import { parseInventoryReport } from "../lib/inventory-report";
import { groupForProduct, groupForSku, type ListGroup } from "../lib/lists";
import {
  backfillReportFingerprints,
  reportFingerprint,
  reverseRunStock,
} from "../lib/broilers";
import { manager } from "../middleware/manager";

/** Per-SKU roll-up of everything sold in a run, tagged with the list it belongs on. */
type SkuTotal = {
  sku: string;
  itemName: string;
  quantity: number;
  listGroup: ListGroup;
};

async function loadRun(runId: number) {
  const [run] = await db.select().from(schema.packRuns).where(eq(schema.packRuns.id, runId));
  if (!run) throw new ORPCError("NOT_FOUND", { message: "Weekly list not found" });
  const lines = await db
    .select()
    .from(schema.packRunLines)
    .where(eq(schema.packRunLines.runId, runId))
    .orderBy(asc(schema.packRunLines.sku));
  const recipe = await db
    .select()
    .from(schema.boxRecipeItems)
    .where(eq(schema.boxRecipeItems.runId, runId))
    .orderBy(asc(schema.boxRecipeItems.sku));
  return { run, lines, recipe };
}

function skuTotals(lines: (typeof schema.packRunLines.$inferSelect)[]): SkuTotal[] {
  const map = new Map<string, SkuTotal>();
  for (const l of lines) {
    const existing = map.get(l.sku);
    if (existing) {
      existing.quantity += l.quantity;
    } else {
      map.set(l.sku, {
        sku: l.sku,
        itemName: l.itemName,
        quantity: l.quantity,
        listGroup: (l.listGroup as ListGroup) || groupForSku(l.sku),
      });
    }
  }
  return [...map.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * The harvest list: every vegetable needed this week, as one combined total per SKU —
 * what customers bought loose, plus what the box recipe multiplies out across the boxes.
 */
function harvestRows(
  totals: SkuTotal[],
  recipe: (typeof schema.boxRecipeItems.$inferSelect)[],
  boxCount: number,
) {
  const rows = new Map<string, { sku: string; item: string; loose: number; boxes: number }>();
  for (const t of totals) {
    if (t.listGroup !== "harvest") continue;
    rows.set(t.sku, { sku: t.sku, item: t.itemName, loose: t.quantity, boxes: 0 });
  }
  for (const r of recipe) {
    const row = rows.get(r.sku);
    const boxes = r.qtyPerBox * boxCount;
    if (row) {
      row.boxes += boxes;
    } else {
      rows.set(r.sku, { sku: r.sku, item: r.description || r.sku, loose: 0, boxes });
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, total: round3(r.loose + r.boxes) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Per-customer allocation for a group — who gets what, grouped by item. */
function allocationRows(lines: (typeof schema.packRunLines.$inferSelect)[], group: ListGroup) {
  return lines
    .filter((l) => (l.listGroup as ListGroup) === group && l.quantity > 0)
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.contact.localeCompare(b.contact));
}

/** Supplier order: one line per SKU, quantity only. */
function orderRows(totals: SkuTotal[], group: ListGroup) {
  return totals.filter((t) => t.listGroup === group && t.quantity > 0);
}

function allocationCsv(
  lines: (typeof schema.packRunLines.$inferSelect)[],
  group: ListGroup,
  quantityHeader: string,
) {
  const rows: (string | number)[][] = [];
  const picked = allocationRows(lines, group);
  let currentSku = "";
  let subtotal = 0;
  const flush = () => {
    if (currentSku) rows.push(["", `Total ${currentSku}`, "", round3(subtotal), ""]);
  };
  for (const l of picked) {
    if (l.sku !== currentSku) {
      flush();
      currentSku = l.sku;
      subtotal = 0;
    }
    rows.push([l.sku, l.itemName, l.contact, round3(l.quantity), l.reference]);
    subtotal += l.quantity;
  }
  flush();
  return toCsv(["SKU", "Item", "Customer", quantityHeader, "Invoice"], rows);
}

const fileStem = (run: typeof schema.packRuns.$inferSelect) =>
  run.periodTo ?? run.periodFrom ?? new Date().toISOString().slice(0, 10);

export const lists = {
  /** Every imported week, newest first. */
  runs: base.handler(() =>
    db.select().from(schema.packRuns).orderBy(desc(schema.packRuns.id)).limit(50),
  ),

  /**
   * Import a Xero "Inventory Item Details" report (xlsx as base64, or CSV text) and
   * turn it into a week's worth of lists. Box quantities are summed off the box SKUs.
   */
  importReport: base
    .input(
      z.object({
        csv: z.string().optional(),
        base64: z.string().optional(),
        fileName: z.string().default(""),
      }),
    )
    .handler(async ({ input }) => {
      if (!input.csv && !input.base64) {
        throw new ORPCError("BAD_REQUEST", { message: "Attach a .xlsx or .csv report" });
      }
      const parsed = parseInventoryReport({ csv: input.csv, base64: input.base64 });
      if (parsed.lines.length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "No invoice lines found. Export Xero's Inventory Item Details report for the week and upload that file.",
        });
      }
      await backfillReportFingerprints();
      const fingerprint = reportFingerprint(parsed);
      const [duplicate] = await db
        .select({ id: schema.packRuns.id, label: schema.packRuns.label })
        .from(schema.packRuns)
        .where(eq(schema.packRuns.reportFingerprint, fingerprint))
        .limit(1);
      if (duplicate) {
        throw new ORPCError("CONFLICT", {
          message: `This report has already been imported as ${duplicate.label}. Delete that week before re-importing it.`,
        });
      }

      // Products can override the prefix rule, so resolve groups against the catalog.
      const catalog = await db.select().from(schema.products);
      const overrides = new Map(catalog.map((p) => [p.sku, p.listGroup]));
      const groupOf = (sku: string) => groupForProduct(sku, overrides.get(sku));

      const boxCount = parsed.lines
        .filter((l) => groupOf(l.sku) === "box")
        .reduce((n, l) => n + l.quantity, 0);

      const period =
        parsed.periodFrom && parsed.periodTo
          ? `${parsed.periodFrom} → ${parsed.periodTo}`
          : (parsed.periodFrom ?? parsed.periodTo ?? new Date().toISOString().slice(0, 10));

      const [run] = await db
        .insert(schema.packRuns)
        .values({
          label: `Week ${period}`,
          periodFrom: parsed.periodFrom,
          periodTo: parsed.periodTo,
          fileName: input.fileName,
          boxCount,
          reportFingerprint: fingerprint,
        })
        .returning();

      await db.insert(schema.packRunLines).values(
        parsed.lines.map((l) => ({
          runId: run.id,
          sku: l.sku,
          itemName: l.itemName,
          description: l.description,
          reference: l.reference,
          contact: l.contact,
          quantity: l.quantity,
          value: l.value,
          listGroup: groupOf(l.sku),
        })),
      );

      // Carry the previous week's box contents forward as a starting point.
      const [previous] = await db
        .select()
        .from(schema.packRuns)
        .where(lt(schema.packRuns.id, run.id))
        .orderBy(desc(schema.packRuns.id))
        .limit(1);
      let carriedOver = 0;
      if (previous) {
        const prevRecipe = await db
          .select()
          .from(schema.boxRecipeItems)
          .where(eq(schema.boxRecipeItems.runId, previous.id));
        if (prevRecipe.length > 0) {
          await db.insert(schema.boxRecipeItems).values(
            prevRecipe.map((r) => ({
              runId: run.id,
              boxSku: r.boxSku,
              sku: r.sku,
              description: r.description,
              qtyPerBox: r.qtyPerBox,
            })),
          );
          carriedOver = prevRecipe.length;
        }
      }

      return {
        runId: run.id,
        label: run.label,
        lineCount: parsed.lines.length,
        skuCount: parsed.skus.length,
        boxCount,
        carriedOver,
      };
    }),

  /** Everything the Weekly Lists screen needs for one run. */
  detail: base.input(z.object({ runId: z.number() })).handler(async ({ input }) => {
    const { run, lines, recipe } = await loadRun(input.runId);
    const totals = skuTotals(lines);
    const boxSkus = [...new Set(totals.filter((t) => t.listGroup === "box").map((t) => t.sku))];

    // Everything that can go in a box: veg in the catalog, plus any veg SKU this
    // week's report or recipe mentions that is not in the catalog yet.
    const catalog = await db.select().from(schema.products);
    const options = new Map<string, string>();
    for (const p of catalog) {
      if (groupForProduct(p.sku, p.listGroup) === "harvest") {
        options.set(p.sku, p.description || p.sku);
      }
    }
    for (const t of totals) {
      if (t.listGroup === "harvest" && !options.has(t.sku)) options.set(t.sku, t.itemName);
    }
    for (const r of recipe) {
      if (!options.has(r.sku)) options.set(r.sku, r.description || r.sku);
    }
    const vegOptions = [...options.entries()]
      .map(([sku, description]) => ({ sku, description }))
      .sort((a, b) => a.sku.localeCompare(b.sku));

    return {
      run,
      boxSkus: boxSkus.length > 0 ? boxSkus : ["VEGBOX"],
      recipe,
      vegOptions,
      harvest: harvestRows(totals, recipe, run.boxCount),
      meat: orderRows(totals, "meat"),
      meatAllocation: allocationRows(lines, "meat"),
      eggs: orderRows(totals, "eggs"),
      eggAllocation: allocationRows(lines, "eggs"),
      veldwonder: orderRows(totals, "veldwonder"),
      milkwood: orderRows(totals, "milkwood"),
      unclassified: totals.filter((t) => t.listGroup === "other"),
    };
  }),

  /** Replace a run's box contents with the chosen veg. */
  saveRecipe: base
    .input(
      z.object({
        runId: z.number(),
        boxSku: z.string().default("VEGBOX"),
        items: z.array(
          z.object({
            sku: z.string().min(1),
            description: z.string().default(""),
            qtyPerBox: z.number().min(0),
          }),
        ),
      }),
    )
    .handler(async ({ input }) => {
      await loadRun(input.runId);
      await db
        .delete(schema.boxRecipeItems)
        .where(eq(schema.boxRecipeItems.runId, input.runId));
      const items = input.items.filter((i) => i.qtyPerBox > 0);
      if (items.length > 0) {
        await db.insert(schema.boxRecipeItems).values(
          items.map((i) => ({
            runId: input.runId,
            boxSku: input.boxSku,
            sku: i.sku.trim().toUpperCase(),
            description: i.description,
            qtyPerBox: i.qtyPerBox,
          })),
        );
      }
      return { saved: items.length };
    }),

  /** One of the weekly lists as a CSV download. */
  exportCsv: base
    .input(
      z.object({
        runId: z.number(),
        list: z.enum(["harvest", "meat", "eggs", "veldwonder", "milkwood"]),
      }),
    )
    .handler(async ({ input }) => {
      const { run, lines, recipe } = await loadRun(input.runId);
      const totals = skuTotals(lines);
      const stem = fileStem(run);

      if (input.list === "harvest") {
        const rows = harvestRows(totals, recipe, run.boxCount);
        const csv = toCsv(
          ["SKU", "Vegetable", "Quantity to harvest"],
          rows.map((r) => [r.sku, r.item, r.total]),
        );
        return { csv, fileName: `harvest-list-${stem}.csv` };
      }

      if (input.list === "meat") {
        return {
          csv: allocationCsv(lines, "meat", "Quantity"),
          fileName: `meat-allocation-${stem}.csv`,
        };
      }

      if (input.list === "eggs") {
        return {
          csv: allocationCsv(lines, "eggs", "Quantity"),
          fileName: `egg-packing-${stem}.csv`,
        };
      }

      const group: ListGroup = input.list === "veldwonder" ? "veldwonder" : "milkwood";
      const supplier = input.list === "veldwonder" ? "VeldWonder" : "Milkwood";
      const rows = orderRows(totals, group);
      const csv = toCsv(
        ["SKU", "Product", "Quantity to order"],
        rows.map((r) => [r.sku, r.itemName, round3(r.quantity)]),
      );
      return { csv, fileName: `${supplier.toLowerCase()}-order-${stem}.csv` };
    }),

  removeRun: manager
    .input(z.object({ runId: z.number() }))
    .handler(async ({ input, context }) => {
      return db.transaction(async (tx) => {
        await reverseRunStock(input.runId, context.manager.email, tx);
        await tx.delete(schema.packRunLines).where(eq(schema.packRunLines.runId, input.runId));
        await tx.delete(schema.boxRecipeItems).where(eq(schema.boxRecipeItems.runId, input.runId));
        await tx.delete(schema.packRuns).where(eq(schema.packRuns.id, input.runId));
        return { ok: true };
      });
    }),
};
