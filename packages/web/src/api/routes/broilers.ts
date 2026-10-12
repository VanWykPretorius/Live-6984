import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { base } from "../__core/app";
import { db } from "../database";
import * as schema from "../database/schema";
import { manager } from "../middleware/manager";
import {
  activeEmployee,
  assertUniquePens,
  batchOrThrow,
  changePenBalance,
  ensureBroilerDefaults,
  penBalance,
  penOrThrow,
  reverseRunStock,
  roundKg,
  stockRequirementsForRun,
} from "../lib/broilers";
import { applyRunEggStock, eggRequirementsForRun, eggStockRegister } from "../lib/layers";

const id = z.number().int().positive();
const date = z.iso.date();
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
const auditEvent = (action: string, actor: string, note = "") => ({
  action,
  at: new Date().toISOString(),
  actor,
  note,
});
const positiveCount = z.number().int().positive().max(100000);
const allocationInput = z
  .array(z.object({ penId: id, count: positiveCount }))
  .min(1)
  .max(20);

function assertLogDate(value: string) {
  if (value > today()) {
    throw new ORPCError("BAD_REQUEST", { message: "You cannot log a future date." });
  }
}

function batchStatus(batch: typeof schema.broilerBatches.$inferSelect, liveBirds: number) {
  if (!batch.actualDate) return "planned";
  return liveBirds === 0 ? "closed" : "active";
}

async function updateBatch(
  tx: typeof db,
  batch: typeof schema.broilerBatches.$inferSelect,
  values: Partial<typeof schema.broilerBatches.$inferInsert>,
  expectedRevision = batch.revision,
) {
  const [updated] = await tx
    .update(schema.broilerBatches)
    .set({
      ...values,
      revision: batch.revision + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.broilerBatches.id, batch.id),
        eq(schema.broilerBatches.revision, expectedRevision),
      ),
    )
    .returning();
  if (!updated) {
    throw new ORPCError("CONFLICT", {
      message: "This batch changed on another device. Refresh and try again.",
    });
  }
  return updated;
}

async function stockProduct(productId: number, tx: typeof db = db) {
  const [row] = await tx
    .select({ stock: schema.broilerStockProducts, product: schema.products })
    .from(schema.broilerStockProducts)
    .innerJoin(schema.products, eq(schema.products.id, schema.broilerStockProducts.productId))
    .where(eq(schema.broilerStockProducts.productId, productId));
  if (!row || !row.product.active || !row.stock.enabled) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose an active product enabled for chicken stock.",
    });
  }
  return row;
}

async function loadEvents(limit = 100) {
  const eventRows = await db
    .select({ event: schema.broilerEvents, employeeName: schema.farmEmployees.name })
    .from(schema.broilerEvents)
    .leftJoin(schema.farmEmployees, eq(schema.farmEmployees.id, schema.broilerEvents.employeeId))
    .orderBy(desc(schema.broilerEvents.id))
    .limit(limit);
  const eventIds = eventRows.map((row) => row.event.id);
  if (eventIds.length === 0) return [];
  const allocations = await db
    .select({ allocation: schema.broilerEventAllocations, pen: schema.broilerPens.name })
    .from(schema.broilerEventAllocations)
    .innerJoin(schema.broilerPens, eq(schema.broilerPens.id, schema.broilerEventAllocations.penId));
  const slaughters = await db.select().from(schema.broilerSlaughters);
  const outputs = await db
    .select({ output: schema.broilerSlaughterOutputs, product: schema.products })
    .from(schema.broilerSlaughterOutputs)
    .innerJoin(schema.products, eq(schema.products.id, schema.broilerSlaughterOutputs.productId));
  return eventRows.map(({ event, employeeName }) => ({
    ...event,
    employeeName,
    allocations: allocations
      .filter((row) => row.allocation.eventId === event.id)
      .map((row) => ({ ...row.allocation, penName: row.pen })),
    slaughter: slaughters.find((row) => row.eventId === event.id) ?? null,
    outputs: outputs
      .filter((row) => row.output.eventId === event.id)
      .map((row) => ({
        ...row.output,
        sku: row.product.sku,
        description: row.product.description,
      })),
  }));
}

async function loadFeedHistory(limit = 100) {
  return db
    .select({
      movement: schema.broilerFeedMovements,
      feed: schema.broilerFeedTypes.name,
      employee: schema.farmEmployees.name,
      batch: schema.broilerBatches.name,
      pen: schema.broilerPens.name,
    })
    .from(schema.broilerFeedMovements)
    .innerJoin(
      schema.broilerFeedTypes,
      eq(schema.broilerFeedTypes.id, schema.broilerFeedMovements.feedTypeId),
    )
    .leftJoin(schema.farmEmployees, eq(schema.farmEmployees.id, schema.broilerFeedMovements.employeeId))
    .leftJoin(schema.broilerBatches, eq(schema.broilerBatches.id, schema.broilerFeedMovements.batchId))
    .leftJoin(schema.broilerPens, eq(schema.broilerPens.id, schema.broilerFeedMovements.penId))
    .orderBy(desc(schema.broilerFeedMovements.id))
    .limit(limit);
}

async function loadGasHistory(limit = 100) {
  return db
    .select({
      movement: schema.broilerGasMovements,
      employee: schema.farmEmployees.name,
      batch: schema.broilerBatches.name,
      pen: schema.broilerPens.name,
    })
    .from(schema.broilerGasMovements)
    .leftJoin(schema.farmEmployees, eq(schema.farmEmployees.id, schema.broilerGasMovements.employeeId))
    .leftJoin(schema.broilerBatches, eq(schema.broilerBatches.id, schema.broilerGasMovements.batchId))
    .leftJoin(schema.broilerPens, eq(schema.broilerPens.id, schema.broilerGasMovements.penId))
    .orderBy(desc(schema.broilerGasMovements.id))
    .limit(limit);
}

async function gasRegister(tx: typeof db = db) {
  const [gas] = await tx.select().from(schema.broilerGas).where(eq(schema.broilerGas.id, 1));
  if (!gas) throw new ORPCError("NOT_FOUND", { message: "Gas register not found." });
  return gas;
}

async function loadStockProducts() {
  await ensureBroilerDefaults();
  return db
    .select({ stock: schema.broilerStockProducts, product: schema.products })
    .from(schema.broilerStockProducts)
    .innerJoin(schema.products, eq(schema.products.id, schema.broilerStockProducts.productId))
    .orderBy(asc(schema.products.sku));
}

async function loadBatchLocations(batchIds: number[]) {
  if (batchIds.length === 0) return [];
  const rows = await db
    .select({ stock: schema.broilerPenStocks, pen: schema.broilerPens })
    .from(schema.broilerPenStocks)
    .innerJoin(schema.broilerPens, eq(schema.broilerPens.id, schema.broilerPenStocks.penId));
  return rows.filter((row) => batchIds.includes(row.stock.batchId) && row.stock.birdCount > 0);
}

export const broilers = {
  /** Trusted shared-device logging options; employee names are selectors, not authentication. */
  logOptions: base.handler(async () => {
    await ensureBroilerDefaults();
    const [employees, pens, feedTypes, batches] = await Promise.all([
      db
        .select()
        .from(schema.farmEmployees)
        .where(eq(schema.farmEmployees.active, true))
        .orderBy(asc(schema.farmEmployees.name)),
      db
        .select()
        .from(schema.broilerPens)
        .where(eq(schema.broilerPens.active, true))
        .orderBy(asc(schema.broilerPens.kind), asc(schema.broilerPens.name)),
      db
        .select()
        .from(schema.broilerFeedTypes)
        .where(eq(schema.broilerFeedTypes.active, true))
        .orderBy(asc(schema.broilerFeedTypes.name)),
      db
        .select()
        .from(schema.broilerBatches)
        .where(eq(schema.broilerBatches.status, "active"))
        .orderBy(desc(schema.broilerBatches.actualDate)),
    ]);
    const locations = await loadBatchLocations(batches.map((batch) => batch.id));
    const stockProducts = (await loadStockProducts()).filter(
      (row) => row.product.active && row.stock.enabled,
    );
    const gas = await gasRegister();
    return {
      today: today(),
      employees,
      pens,
      feedTypes,
      gas,
      batches: batches.map((batch) => ({
        ...batch,
        pens: locations
          .filter((row) => row.stock.batchId === batch.id)
          .map((row) => ({ ...row.stock, name: row.pen.name, kind: row.pen.kind })),
      })),
      stockProducts: stockProducts.map((row) => ({ ...row.stock, product: row.product })),
    };
  }),

  overview: manager.handler(async () => {
    await ensureBroilerDefaults();
    const [pens, feedTypes, batches, feedHistory, stockProducts, stockMovements, salesRuns, gas, gasHistory] =
      await Promise.all([
        db.select().from(schema.broilerPens).orderBy(asc(schema.broilerPens.kind), asc(schema.broilerPens.name)),
        db.select().from(schema.broilerFeedTypes).orderBy(asc(schema.broilerFeedTypes.name)),
        db.select().from(schema.broilerBatches).orderBy(desc(schema.broilerBatches.plannedDate)),
        loadFeedHistory(),
        loadStockProducts(),
        db
          .select({ movement: schema.broilerStockMovements, product: schema.products })
          .from(schema.broilerStockMovements)
          .innerJoin(schema.products, eq(schema.products.id, schema.broilerStockMovements.productId))
          .orderBy(desc(schema.broilerStockMovements.id))
          .limit(100),
        db.select().from(schema.packRuns).orderBy(desc(schema.packRuns.id)).limit(20),
        gasRegister(),
        loadGasHistory(),
      ]);
    const locations = await loadBatchLocations(batches.map((batch) => batch.id));
    const events = await loadEvents();
    return {
      today: today(),
      pens,
      feedTypes,
      batches: batches.map((batch) => ({
        ...batch,
        pens: locations
          .filter((row) => row.stock.batchId === batch.id)
          .map((row) => ({ ...row.stock, name: row.pen.name, kind: row.pen.kind })),
      })),
      events,
      feedHistory,
      gas,
      gasHistory,
      stockProducts: stockProducts.map((row) => ({ ...row.stock, product: row.product })),
      stockMovements,
      salesRuns,
    };
  }),

  createBatch: manager
    .input(
      z.object({
        name: z.string().trim().max(100).default(""),
        plannedDate: date,
        plannedCount: positiveCount,
        supplier: z.string().trim().max(150).default(""),
        chickCost: z.number().min(0).max(10000000).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const at = new Date().toISOString();
      try {
        const [batch] = await db
          .insert(schema.broilerBatches)
          .values({
            name: input.name || `Broilers ${input.plannedDate}`,
            plannedDate: input.plannedDate,
            plannedCount: input.plannedCount,
            supplier: input.supplier,
            chickCost: input.chickCost ?? null,
            updatedAt: at,
            audit: [auditEvent("planned", context.manager.email)],
          })
          .returning();
        return batch;
      } catch {
        throw new ORPCError("BAD_REQUEST", { message: "That batch name is already in use." });
      }
    }),

  updateBatchPlan: manager
    .input(
      z.object({
        batchId: id,
        revision: z.number().int().positive(),
        name: z.string().trim().min(1).max(100),
        plannedDate: date,
        plannedCount: positiveCount,
        supplier: z.string().trim().max(150).default(""),
        chickCost: z.number().min(0).max(10000000).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const batch = await batchOrThrow(input.batchId);
      if (batch.status !== "planned") {
        throw new ORPCError("CONFLICT", { message: "Only a planned batch can be edited." });
      }
      try {
        return await updateBatch(db, batch, {
          name: input.name,
          plannedDate: input.plannedDate,
          plannedCount: input.plannedCount,
          supplier: input.supplier,
          chickCost: input.chickCost ?? null,
          audit: [
            ...batch.audit,
            auditEvent("plan updated", context.manager.email),
          ],
        });
      } catch (error) {
        if (error instanceof ORPCError) throw error;
        throw new ORPCError("BAD_REQUEST", { message: "That batch name is already in use." });
      }
    }),

  confirmArrival: manager
    .input(
      z.object({
        batchId: id,
        revision: z.number().int().positive(),
        actualDate: date,
        receivedCount: positiveCount,
        deadOnArrival: z.number().int().min(0).max(100000).default(0),
        arrivalPenId: id,
      }),
    )
    .handler(async ({ input, context }) => {
      assertLogDate(input.actualDate);
      if (input.deadOnArrival >= input.receivedCount) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Dead-on-arrival must be lower than the chicks received.",
        });
      }
      const batch = await batchOrThrow(input.batchId);
      const pen = await penOrThrow(input.arrivalPenId);
      if (batch.status !== "planned") {
        throw new ORPCError("CONFLICT", { message: "This arrival has already been confirmed." });
      }
      if (pen.kind !== "brooder") {
        throw new ORPCError("BAD_REQUEST", { message: "Choose a brooder pen." });
      }
      return db.transaction(async (tx) => {
        const live = input.receivedCount - input.deadOnArrival;
        const updated = await updateBatch(
          tx,
          batch,
          {
            actualDate: input.actualDate,
            receivedCount: input.receivedCount,
            deadOnArrival: input.deadOnArrival,
            arrivalPenId: input.arrivalPenId,
            liveBirds: live,
            status: live > 0 ? "active" : "closed",
            audit: [
              ...batch.audit,
              auditEvent("arrival confirmed", context.manager.email, `${live} live chicks`),
            ],
          },
          input.revision,
        );
        const [event] = await tx
          .insert(schema.broilerEvents)
          .values({
            batchId: batch.id,
            type: "arrival",
            eventDate: input.actualDate,
            totalCount: live,
            actor: context.manager.email,
            note: `${input.receivedCount} received; ${input.deadOnArrival} dead on arrival`,
          })
          .returning();
        await tx.insert(schema.broilerEventAllocations).values({
          eventId: event.id,
          penId: input.arrivalPenId,
          role: "arrival",
          birdCount: live,
        });
        await changePenBalance(batch.id, input.arrivalPenId, live, tx);
        return updated;
      });
    }),

  logDeath: base
    .input(
      z.object({
        employeeId: id,
        batchId: id,
        revision: z.number().int().positive(),
        eventDate: date,
        allocations: allocationInput,
        cause: z.string().trim().max(150).default(""),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .handler(async ({ input }) => {
      assertLogDate(input.eventDate);
      assertUniquePens(input.allocations);
      const [employee, batch] = await Promise.all([
        activeEmployee(input.employeeId),
        batchOrThrow(input.batchId),
      ]);
      if (!batch.actualDate || batch.status !== "active" || input.eventDate < batch.actualDate) {
        throw new ORPCError("BAD_REQUEST", { message: "Choose an active batch and a date after arrival." });
      }
      const total = input.allocations.reduce((sum, row) => sum + row.count, 0);
      if (total > batch.liveBirds) {
        throw new ORPCError("BAD_REQUEST", { message: "Deaths cannot exceed the live batch count." });
      }
      return db.transaction(async (tx) => {
        const live = batch.liveBirds - total;
        await updateBatch(
          tx,
          batch,
          {
            liveBirds: live,
            status: batchStatus(batch, live),
            audit: [...batch.audit, auditEvent("deaths logged", employee.name, `${total} birds`)],
          },
          input.revision,
        );
        for (const allocation of input.allocations) {
          await changePenBalance(batch.id, allocation.penId, -allocation.count, tx);
        }
        const [event] = await tx
          .insert(schema.broilerEvents)
          .values({
            batchId: batch.id,
            type: "death",
            eventDate: input.eventDate,
            totalCount: total,
            employeeId: employee.id,
            actor: employee.name,
            reason: input.cause,
            note: input.note,
          })
          .returning();
        await tx.insert(schema.broilerEventAllocations).values(
          input.allocations.map((allocation) => ({
            eventId: event.id,
            penId: allocation.penId,
            role: "remove",
            birdCount: allocation.count,
          })),
        );
        return { eventId: event.id, liveBirds: live };
      });
    }),

  logMove: base
    .input(
      z.object({
        employeeId: id,
        batchId: id,
        revision: z.number().int().positive(),
        eventDate: date,
        fromPenId: id,
        destinations: allocationInput,
        reason: z.string().trim().max(300).default(""),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .handler(async ({ input }) => {
      assertLogDate(input.eventDate);
      assertUniquePens(input.destinations);
      const [employee, batch, source] = await Promise.all([
        activeEmployee(input.employeeId),
        batchOrThrow(input.batchId),
        penOrThrow(input.fromPenId),
      ]);
      if (!batch.actualDate || batch.status !== "active" || input.eventDate < batch.actualDate) {
        throw new ORPCError("BAD_REQUEST", { message: "Choose an active batch and a date after arrival." });
      }
      if (source.kind !== "brooder") {
        throw new ORPCError("BAD_REQUEST", { message: "Moves out of the brooder must start in a brooder pen." });
      }
      if (input.destinations.some((row) => row.penId === input.fromPenId)) {
        throw new ORPCError("BAD_REQUEST", { message: "The destination pen must differ from the source." });
      }
      const destinations = await Promise.all(input.destinations.map((row) => penOrThrow(row.penId)));
      const destinationKinds = new Set(destinations.map((pen) => pen.kind));
      if (destinationKinds.size !== 1) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Move into brooder pens or pasture pens in one entry, not both at once.",
        });
      }
      const destinationKind = [...destinationKinds][0];
      const expected = await penBalance(batch.id, input.fromPenId);
      const total = input.destinations.reduce((sum, row) => sum + row.count, 0);
      const adjustment = total - expected;
      if (adjustment !== 0 && !input.reason) {
        throw new ORPCError("BAD_REQUEST", {
          message: `The brooder count changed by ${adjustment}. Add the reason for this adjustment.`,
        });
      }
      return db.transaction(async (tx) => {
        const live = batch.liveBirds + adjustment;
        if (live < 0) {
          throw new ORPCError("BAD_REQUEST", { message: "The recount cannot make the batch negative." });
        }
        await updateBatch(
          tx,
          batch,
          {
            liveBirds: live,
            status: batchStatus(batch, live),
            audit: [
              ...batch.audit,
              auditEvent(`moved to ${destinationKind}`, employee.name, `${total} birds; adjustment ${adjustment}`),
            ],
          },
          input.revision,
        );
        if (adjustment > 0) await changePenBalance(batch.id, input.fromPenId, adjustment, tx);
        await changePenBalance(batch.id, input.fromPenId, -total, tx);
        for (const allocation of input.destinations) {
          await changePenBalance(batch.id, allocation.penId, allocation.count, tx);
        }
        const [event] = await tx
          .insert(schema.broilerEvents)
          .values({
            batchId: batch.id,
            type: "move",
            eventDate: input.eventDate,
            totalCount: total,
            employeeId: employee.id,
            actor: employee.name,
            expectedCount: expected,
            reason: input.reason,
            note: input.note,
          })
          .returning();
        await tx.insert(schema.broilerEventAllocations).values([
          {
            eventId: event.id,
            penId: input.fromPenId,
            role: "source",
            birdCount: total,
          },
          ...input.destinations.map((allocation) => ({
            eventId: event.id,
            penId: allocation.penId,
            role: "destination",
            birdCount: allocation.count,
          })),
        ]);
        return { eventId: event.id, expected, counted: total, adjustment, liveBirds: live };
      });
    }),

  logSlaughter: base
    .input(
      z.object({
        employeeId: id,
        batchId: id,
        revision: z.number().int().positive(),
        eventDate: date,
        allocations: allocationInput,
        totalDressedWeightKg: z.number().positive().max(1000000),
        outputs: z
          .array(
            z.object({
              productId: id,
              weightKg: z.number().positive().max(1000000),
              /** Bag count for bag-tracked products (converted to kg server-side). */
              bags: z.number().positive().max(1000000).optional(),
            }),
          )
          .min(1)
          .max(50),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .handler(async ({ input }) => {
      assertLogDate(input.eventDate);
      assertUniquePens(input.allocations);
      if (new Set(input.outputs.map((row) => row.productId)).size !== input.outputs.length) {
        throw new ORPCError("BAD_REQUEST", { message: "Use each stock product only once." });
      }
      // Bag-tracked products take bag counts; convert to kg before the kg pipeline.
      const outputs = [] as { productId: number; weightKg: number }[];
      for (const output of input.outputs) {
        const row = await stockProduct(output.productId);
        if (row.stock.unit === "bags") {
          if (output.bags === undefined) {
            throw new ORPCError("BAD_REQUEST", {
              message: `${row.product.description} is counted in bags — enter the number of bags.`,
            });
          }
          outputs.push({ productId: output.productId, weightKg: roundKg(output.bags * row.stock.kgPerUnit) });
        } else {
          outputs.push({ productId: output.productId, weightKg: output.weightKg });
        }
      }
      const [employee, batch] = await Promise.all([
        activeEmployee(input.employeeId),
        batchOrThrow(input.batchId),
      ]);
      if (!batch.actualDate || batch.status !== "active" || input.eventDate < batch.actualDate) {
        throw new ORPCError("BAD_REQUEST", { message: "Choose an active batch and a date after arrival." });
      }
      const pens = await Promise.all(input.allocations.map((row) => penOrThrow(row.penId)));
      if (pens.some((pen) => pen.kind !== "pasture")) {
        throw new ORPCError("BAD_REQUEST", { message: "Slaughter counts must come from pasture pens." });
      }
      const total = input.allocations.reduce((sum, row) => sum + row.count, 0);
      if (total > batch.liveBirds) {
        throw new ORPCError("BAD_REQUEST", { message: "Slaughter cannot exceed the live batch count." });
      }
      const productTotal = roundKg(outputs.reduce((sum, row) => sum + row.weightKg, 0));
      if (productTotal - input.totalDressedWeightKg > 0.001) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Product weights cannot exceed the total dressed weight.",
        });
      }
      return db.transaction(async (tx) => {
        for (const output of outputs) await stockProduct(output.productId, tx);
        const live = batch.liveBirds - total;
        await updateBatch(
          tx,
          batch,
          {
            liveBirds: live,
            status: batchStatus(batch, live),
            audit: [...batch.audit, auditEvent("slaughter logged", employee.name, `${total} birds`)],
          },
          input.revision,
        );
        for (const allocation of input.allocations) {
          await changePenBalance(batch.id, allocation.penId, -allocation.count, tx);
        }
        const [event] = await tx
          .insert(schema.broilerEvents)
          .values({
            batchId: batch.id,
            type: "slaughter",
            eventDate: input.eventDate,
            totalCount: total,
            employeeId: employee.id,
            actor: employee.name,
            note: input.note,
          })
          .returning();
        await tx.insert(schema.broilerEventAllocations).values(
          input.allocations.map((allocation) => ({
            eventId: event.id,
            penId: allocation.penId,
            role: "remove",
            birdCount: allocation.count,
          })),
        );
        await tx.insert(schema.broilerSlaughters).values({
          eventId: event.id,
          totalDressedWeightKg: input.totalDressedWeightKg,
          totalProductWeightKg: productTotal,
        });
        await tx.insert(schema.broilerSlaughterOutputs).values(
          outputs.map((output) => ({ eventId: event.id, ...output })),
        );
        for (const output of outputs) {
          const row = await stockProduct(output.productId, tx);
          await tx
            .update(schema.broilerStockProducts)
            .set({
              kgOnHand: roundKg(row.stock.kgOnHand + output.weightKg),
              revision: row.stock.revision + 1,
            })
            .where(eq(schema.broilerStockProducts.productId, output.productId));
          await tx.insert(schema.broilerStockMovements).values({
            productId: output.productId,
            kind: "slaughter",
            quantityKg: output.weightKg,
            referenceKey: `slaughter:${event.id}:${output.productId}`,
            referenceId: event.id,
            employeeId: employee.id,
            actor: employee.name,
            note: `${batch.name} slaughter`,
          });
        }
        return { eventId: event.id, slaughtered: total, liveBirds: live, productTotal };
      });
    }),

  logFeed: base
    .input(
      z.object({
        employeeId: id,
        feedTypeId: id,
        revision: z.number().int().positive(),
        movementDate: date,
        kind: z.enum(["delivery", "withdrawal"]),
        bags: z.number().int().positive().max(10000),
        batchId: id.nullable().optional(),
        penId: id.nullable().optional(),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .handler(async ({ input }) => {
      assertLogDate(input.movementDate);
      const employee = await activeEmployee(input.employeeId);
      const [feed] = await db
        .select()
        .from(schema.broilerFeedTypes)
        .where(
          and(
            eq(schema.broilerFeedTypes.id, input.feedTypeId),
            eq(schema.broilerFeedTypes.active, true),
          ),
        );
      if (!feed) throw new ORPCError("BAD_REQUEST", { message: "Choose an active feed type." });
      if (input.kind === "withdrawal" && input.bags > feed.bagsOnHand) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Only ${feed.bagsOnHand} bag${feed.bagsOnHand === 1 ? "" : "s"} of ${feed.name} remain.`,
        });
      }
      if (input.batchId) {
        const batch = await batchOrThrow(input.batchId);
        if (batch.status !== "active") {
          throw new ORPCError("BAD_REQUEST", { message: "Choose an active batch." });
        }
      }
      if (input.penId) await penOrThrow(input.penId);
      return db.transaction(async (tx) => {
        const next = input.kind === "delivery" ? feed.bagsOnHand + input.bags : feed.bagsOnHand - input.bags;
        const [updated] = await tx
          .update(schema.broilerFeedTypes)
          .set({ bagsOnHand: next, revision: feed.revision + 1 })
          .where(
            and(
              eq(schema.broilerFeedTypes.id, feed.id),
              eq(schema.broilerFeedTypes.revision, input.revision),
              ...(input.kind === "withdrawal" ? [gte(schema.broilerFeedTypes.bagsOnHand, input.bags)] : []),
            ),
          )
          .returning();
        if (!updated) {
          throw new ORPCError("CONFLICT", {
            message: "The feed register changed on another device. Refresh and try again.",
          });
        }
        const [movement] = await tx
          .insert(schema.broilerFeedMovements)
          .values({
            feedTypeId: feed.id,
            kind: input.kind,
            movementDate: input.movementDate,
            bags: input.bags,
            batchId: input.kind === "withdrawal" ? (input.batchId ?? null) : null,
            penId: input.kind === "withdrawal" ? (input.penId ?? null) : null,
            employeeId: employee.id,
            actor: employee.name,
            note: input.note,
          })
          .returning();
        return { movementId: movement.id, bagsOnHand: next };
      });
    }),

  logGas: base
    .input(
      z.object({
        employeeId: id,
        revision: z.number().int().positive(),
        movementDate: date,
        kind: z.enum(["delivery", "withdrawal"]),
        bottles: z.number().int().positive().max(1000),
        batchId: id.nullable().optional(),
        penId: id.nullable().optional(),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .handler(async ({ input }) => {
      assertLogDate(input.movementDate);
      await ensureBroilerDefaults();
      const employee = await activeEmployee(input.employeeId);
      const gas = await gasRegister();
      if (input.kind === "withdrawal" && input.bottles > gas.bottlesOnHand) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Only ${gas.bottlesOnHand} gas bottle${gas.bottlesOnHand === 1 ? "" : "s"} remain.`,
        });
      }
      if (input.batchId) {
        const batch = await batchOrThrow(input.batchId);
        if (batch.status !== "active") {
          throw new ORPCError("BAD_REQUEST", { message: "Choose an active batch." });
        }
      }
      if (input.penId) await penOrThrow(input.penId);
      return db.transaction(async (tx) => {
        const next = input.kind === "delivery" ? gas.bottlesOnHand + input.bottles : gas.bottlesOnHand - input.bottles;
        const [updated] = await tx
          .update(schema.broilerGas)
          .set({ bottlesOnHand: next, revision: gas.revision + 1 })
          .where(
            and(
              eq(schema.broilerGas.id, gas.id),
              eq(schema.broilerGas.revision, input.revision),
              ...(input.kind === "withdrawal" ? [gte(schema.broilerGas.bottlesOnHand, input.bottles)] : []),
            ),
          )
          .returning();
        if (!updated) {
          throw new ORPCError("CONFLICT", {
            message: "The gas register changed on another device. Refresh and try again.",
          });
        }
        const [movement] = await tx
          .insert(schema.broilerGasMovements)
          .values({
            kind: input.kind,
            movementDate: input.movementDate,
            bottles: input.bottles,
            batchId: input.kind === "withdrawal" ? (input.batchId ?? null) : null,
            penId: input.kind === "withdrawal" ? (input.penId ?? null) : null,
            employeeId: employee.id,
            actor: employee.name,
            note: input.note,
          })
          .returning();
        return { movementId: movement.id, bottlesOnHand: next };
      });
    }),

  saveGasSettings: manager
    .input(
      z.object({
        revision: z.number().int().positive(),
        bottleSizeKg: z.number().positive().max(100),
        targetBottles: z.number().int().min(0).max(100),
      }),
    )
    .handler(async ({ input }) => {
      await ensureBroilerDefaults();
      const [updated] = await db
        .update(schema.broilerGas)
        .set({
          bottleSizeKg: input.bottleSizeKg,
          targetBottles: input.targetBottles,
          revision: input.revision + 1,
        })
        .where(and(eq(schema.broilerGas.id, 1), eq(schema.broilerGas.revision, input.revision)))
        .returning();
      if (!updated) {
        throw new ORPCError("CONFLICT", { message: "The gas register changed. Refresh and try again." });
      }
      return updated;
    }),

  voidGasMovement: manager
    .input(z.object({ movementId: id, reason: z.string().trim().min(3).max(500) }))
    .handler(async ({ input, context }) => {
      const [movement] = await db
        .select()
        .from(schema.broilerGasMovements)
        .where(eq(schema.broilerGasMovements.id, input.movementId));
      if (!movement) throw new ORPCError("NOT_FOUND", { message: "Gas movement not found." });
      if (movement.voidedAt) {
        throw new ORPCError("CONFLICT", { message: "This gas movement is already voided." });
      }
      return db.transaction(async (tx) => {
        const gas = await gasRegister(tx);
        const delta = movement.kind === "delivery" ? -movement.bottles : movement.bottles;
        if (delta < 0 && gas.bottlesOnHand < movement.bottles) {
          throw new ORPCError("CONFLICT", {
            message: "Those delivered bottles have already been used. Correct the withdrawals first.",
          });
        }
        await tx
          .update(schema.broilerGas)
          .set({ bottlesOnHand: gas.bottlesOnHand + delta, revision: gas.revision + 1 })
          .where(eq(schema.broilerGas.id, gas.id));
        const [voided] = await tx
          .update(schema.broilerGasMovements)
          .set({
            voidedAt: new Date().toISOString(),
            voidedBy: context.manager.email,
            voidReason: input.reason,
          })
          .where(
            and(
              eq(schema.broilerGasMovements.id, movement.id),
              isNull(schema.broilerGasMovements.voidedAt),
            ),
          )
          .returning();
        if (!voided) throw new ORPCError("CONFLICT", { message: "This movement changed. Refresh." });
        return { ok: true, bottlesOnHand: gas.bottlesOnHand + delta };
      });
    }),

  savePen: manager
    .input(
      z.object({
        id: id.optional(),
        name: z.string().trim().min(1).max(100),
        kind: z.enum(["brooder", "pasture"]),
        active: z.boolean().default(true),
      }),
    )
    .handler(async ({ input }) => {
      try {
        if (input.id) {
          const [existing] = await db
            .select()
            .from(schema.broilerPens)
            .where(eq(schema.broilerPens.id, input.id));
          if (!existing) throw new ORPCError("NOT_FOUND", { message: "Pen not found." });
          if (existing.kind !== input.kind) {
            throw new ORPCError("BAD_REQUEST", {
              message: "A pen type cannot change after it is in use. Add a new pen instead.",
            });
          }
          return (
            await db
              .update(schema.broilerPens)
              .set({ name: input.name, active: input.active })
              .where(eq(schema.broilerPens.id, input.id))
              .returning()
          )[0];
        }
        return (await db.insert(schema.broilerPens).values(input).returning())[0];
      } catch (error) {
        if (error instanceof ORPCError) throw error;
        throw new ORPCError("BAD_REQUEST", { message: "That pen name is already in use." });
      }
    }),

  saveFeedType: manager
    .input(
      z.object({
        id: id.optional(),
        name: z.string().trim().min(1).max(100),
        bagWeightKg: z.number().positive().max(1000),
        active: z.boolean().default(true),
      }),
    )
    .handler(async ({ input }) => {
      try {
        if (input.id) {
          return (
            await db
              .update(schema.broilerFeedTypes)
              .set({ name: input.name, bagWeightKg: input.bagWeightKg, active: input.active })
              .where(eq(schema.broilerFeedTypes.id, input.id))
              .returning()
          )[0];
        }
        return (await db.insert(schema.broilerFeedTypes).values(input).returning())[0];
      } catch {
        throw new ORPCError("BAD_REQUEST", { message: "That feed name is already in use." });
      }
    }),

  saveStockProduct: manager
    .input(
      z.object({
        productId: id,
        enabled: z.boolean(),
        kgPerUnit: z.number().positive().max(1000),
      }),
    )
    .handler(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(schema.broilerStockProducts)
        .where(eq(schema.broilerStockProducts.productId, input.productId));
      if (!existing) throw new ORPCError("NOT_FOUND", { message: "Stock product not found." });
      return (
        await db
          .update(schema.broilerStockProducts)
          .set({
            enabled: input.enabled,
            kgPerUnit: input.kgPerUnit,
            revision: existing.revision + 1,
          })
          .where(eq(schema.broilerStockProducts.productId, input.productId))
          .returning()
      )[0];
    }),

  adjustStock: manager
    .input(
      z.object({
        productId: id,
        /** Change in the product's tracking unit: kg for loose stock, bags for bag-tracked. */
        deltaKg: z.number().min(-1000000).max(1000000).refine((value) => value !== 0),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .handler(async ({ input, context }) => {
      return db.transaction(async (tx) => {
        const [stock] = await tx
          .select()
          .from(schema.broilerStockProducts)
          .where(eq(schema.broilerStockProducts.productId, input.productId));
        if (!stock) throw new ORPCError("NOT_FOUND", { message: "Stock product not found." });
        const deltaKg = stock.unit === "bags" ? roundKg(input.deltaKg * stock.kgPerUnit) : roundKg(input.deltaKg);
        if (deltaKg < 0 && stock.kgOnHand + deltaKg < -0.0001) {
          throw new ORPCError("BAD_REQUEST", { message: "The adjustment cannot make stock negative." });
        }
        const [updated] = await tx
          .update(schema.broilerStockProducts)
          .set({
            kgOnHand: roundKg(stock.kgOnHand + deltaKg),
            revision: stock.revision + 1,
          })
          .where(eq(schema.broilerStockProducts.productId, input.productId))
          .returning();
        await tx.insert(schema.broilerStockMovements).values({
          productId: input.productId,
          kind: "adjustment",
          quantityKg: deltaKg,
          referenceKey: `manual:${crypto.randomUUID()}`,
          actor: context.manager.email,
          note: stock.unit === "bags" ? `${input.deltaKg} bags · ${input.reason}` : input.reason,
        });
        return updated;
      });
    }),

  voidEvent: manager
    .input(z.object({ eventId: id, reason: z.string().trim().min(3).max(500) }))
    .handler(async ({ input, context }) => {
      const [event] = await db
        .select()
        .from(schema.broilerEvents)
        .where(eq(schema.broilerEvents.id, input.eventId));
      if (!event) throw new ORPCError("NOT_FOUND", { message: "Event not found." });
      if (event.voidedAt) throw new ORPCError("CONFLICT", { message: "This event is already voided." });
      const batch = await batchOrThrow(event.batchId);
      const allocations = await db
        .select()
        .from(schema.broilerEventAllocations)
        .where(eq(schema.broilerEventAllocations.eventId, event.id));
      return db.transaction(async (tx) => {
        let live = batch.liveBirds;
        if (event.type === "arrival") {
          const later = await tx
            .select({ id: schema.broilerEvents.id })
            .from(schema.broilerEvents)
            .where(
              and(
                eq(schema.broilerEvents.batchId, batch.id),
                ne(schema.broilerEvents.id, event.id),
                isNull(schema.broilerEvents.voidedAt),
              ),
            )
            .limit(1);
          if (later.length) {
            throw new ORPCError("CONFLICT", {
              message: "Void the later batch events before correcting this arrival.",
            });
          }
          for (const allocation of allocations) {
            await changePenBalance(batch.id, allocation.penId, -allocation.birdCount, tx);
          }
          live = 0;
          await updateBatch(tx, batch, {
            actualDate: null,
            receivedCount: null,
            deadOnArrival: 0,
            arrivalPenId: null,
            liveBirds: 0,
            status: "planned",
            audit: [...batch.audit, auditEvent("arrival voided", context.manager.email, input.reason)],
          });
        } else if (event.type === "death") {
          for (const allocation of allocations) {
            await changePenBalance(batch.id, allocation.penId, allocation.birdCount, tx);
          }
          live += event.totalCount;
          await updateBatch(tx, batch, {
            liveBirds: live,
            status: batchStatus(batch, live),
            audit: [...batch.audit, auditEvent("death entry voided", context.manager.email, input.reason)],
          });
        } else if (event.type === "move") {
          const source = allocations.find((allocation) => allocation.role === "source");
          if (!source) throw new ORPCError("NOT_FOUND", { message: "Move source not found." });
          for (const allocation of allocations.filter((row) => row.role === "destination")) {
            await changePenBalance(batch.id, allocation.penId, -allocation.birdCount, tx);
          }
          await changePenBalance(batch.id, source.penId, source.birdCount, tx);
          const adjustment = event.totalCount - (event.expectedCount ?? event.totalCount);
          live -= adjustment;
          await updateBatch(tx, batch, {
            liveBirds: live,
            status: batchStatus(batch, live),
            audit: [...batch.audit, auditEvent("move voided", context.manager.email, input.reason)],
          });
        } else if (event.type === "slaughter") {
          for (const allocation of allocations) {
            await changePenBalance(batch.id, allocation.penId, allocation.birdCount, tx);
          }
          const outputs = await tx
            .select()
            .from(schema.broilerSlaughterOutputs)
            .where(eq(schema.broilerSlaughterOutputs.eventId, event.id));
          for (const output of outputs) {
            const [stock] = await tx
              .select()
              .from(schema.broilerStockProducts)
              .where(eq(schema.broilerStockProducts.productId, output.productId));
            if (!stock || stock.kgOnHand + 0.0001 < output.weightKg) {
              throw new ORPCError("CONFLICT", {
                message: "Some slaughtered product has already been sold. Adjust or reverse sales before voiding this slaughter.",
              });
            }
            await tx
              .update(schema.broilerStockProducts)
              .set({
                kgOnHand: roundKg(stock.kgOnHand - output.weightKg),
                revision: stock.revision + 1,
              })
              .where(eq(schema.broilerStockProducts.productId, output.productId));
            await tx.insert(schema.broilerStockMovements).values({
              productId: output.productId,
              kind: "slaughter_reversal",
              quantityKg: -output.weightKg,
              referenceKey: `slaughter-reversal:${event.id}:${output.productId}`,
              referenceId: event.id,
              actor: context.manager.email,
              note: input.reason,
            });
          }
          live += event.totalCount;
          await updateBatch(tx, batch, {
            liveBirds: live,
            status: batchStatus(batch, live),
            audit: [...batch.audit, auditEvent("slaughter voided", context.manager.email, input.reason)],
          });
        }
        const [voided] = await tx
          .update(schema.broilerEvents)
          .set({
            voidedAt: new Date().toISOString(),
            voidedBy: context.manager.email,
            voidReason: input.reason,
          })
          .where(and(eq(schema.broilerEvents.id, event.id), isNull(schema.broilerEvents.voidedAt)))
          .returning();
        if (!voided) throw new ORPCError("CONFLICT", { message: "This event changed. Refresh." });
        return { ok: true, liveBirds: live };
      });
    }),

  voidFeedMovement: manager
    .input(z.object({ movementId: id, reason: z.string().trim().min(3).max(500) }))
    .handler(async ({ input, context }) => {
      const [movement] = await db
        .select()
        .from(schema.broilerFeedMovements)
        .where(eq(schema.broilerFeedMovements.id, input.movementId));
      if (!movement) throw new ORPCError("NOT_FOUND", { message: "Feed movement not found." });
      if (movement.voidedAt) {
        throw new ORPCError("CONFLICT", { message: "This feed movement is already voided." });
      }
      return db.transaction(async (tx) => {
        const [feed] = await tx
          .select()
          .from(schema.broilerFeedTypes)
          .where(eq(schema.broilerFeedTypes.id, movement.feedTypeId));
        if (!feed) throw new ORPCError("NOT_FOUND", { message: "Feed type not found." });
        const delta = movement.kind === "delivery" ? -movement.bags : movement.bags;
        if (delta < 0 && feed.bagsOnHand < movement.bags) {
          throw new ORPCError("CONFLICT", {
            message: "Those delivered bags have already been used. Correct the withdrawals first.",
          });
        }
        await tx
          .update(schema.broilerFeedTypes)
          .set({ bagsOnHand: feed.bagsOnHand + delta, revision: feed.revision + 1 })
          .where(eq(schema.broilerFeedTypes.id, feed.id));
        const [voided] = await tx
          .update(schema.broilerFeedMovements)
          .set({
            voidedAt: new Date().toISOString(),
            voidedBy: context.manager.email,
            voidReason: input.reason,
          })
          .where(
            and(
              eq(schema.broilerFeedMovements.id, movement.id),
              isNull(schema.broilerFeedMovements.voidedAt),
            ),
          )
          .returning();
        if (!voided) throw new ORPCError("CONFLICT", { message: "This movement changed. Refresh." });
        return { ok: true, bagsOnHand: feed.bagsOnHand + delta };
      });
    }),

  previewRunStock: manager.input(z.object({ runId: id })).handler(async ({ input }) => {
    const [run] = await db.select().from(schema.packRuns).where(eq(schema.packRuns.id, input.runId));
    if (!run) throw new ORPCError("NOT_FOUND", { message: "Weekly List import not found." });
    const [requirements, eggRequirements, eggStockRow] = await Promise.all([
      stockRequirementsForRun(input.runId),
      eggRequirementsForRun(input.runId),
      eggStockRegister(),
    ]);
    const requiredEggs = eggRequirements.reduce((sum, row) => sum + row.requiredEggs, 0);
    return {
      run,
      applied: !!run.stockAppliedAt,
      requirements,
      eggRequirements,
      eggStock: {
        currentEggs: eggStockRow.eggsOnHand,
        requiredEggs,
        afterEggs: eggStockRow.eggsOnHand - requiredEggs,
        sufficient: eggStockRow.eggsOnHand >= requiredEggs,
      },
    };
  }),

  applyRunStock: manager.input(z.object({ runId: id })).handler(async ({ input, context }) => {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(schema.packRuns)
        .where(eq(schema.packRuns.id, input.runId));
      if (!run) throw new ORPCError("NOT_FOUND", { message: "Weekly List import not found." });
      if (run.stockAppliedAt) {
        throw new ORPCError("CONFLICT", { message: "This report has already been applied to stock." });
      }
      const requirements = await stockRequirementsForRun(input.runId, tx);
      const shortages = requirements.filter((row) => !row.sufficient);
      if (shortages.length) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Not enough chicken stock: ${shortages
            .map((row) => `${row.sku} needs ${row.requiredKg} kg but has ${row.currentKg} kg`)
            .join("; ")}.`,
        });
      }
      for (const requirement of requirements) {
        const [stock] = await tx
          .select()
          .from(schema.broilerStockProducts)
          .where(eq(schema.broilerStockProducts.productId, requirement.productId));
        const [updated] = await tx
          .update(schema.broilerStockProducts)
          .set({
            kgOnHand: roundKg(stock.kgOnHand - requirement.requiredKg),
            revision: stock.revision + 1,
          })
          .where(
            and(
              eq(schema.broilerStockProducts.productId, requirement.productId),
              gte(schema.broilerStockProducts.kgOnHand, requirement.requiredKg - 0.0001),
            ),
          )
          .returning();
        if (!updated) {
          throw new ORPCError("CONFLICT", { message: `${requirement.sku} stock changed. Refresh.` });
        }
        await tx.insert(schema.broilerStockMovements).values({
          productId: requirement.productId,
          kind: "sale",
          quantityKg: -requirement.requiredKg,
          referenceKey: `run:${input.runId}:${requirement.productId}:${crypto.randomUUID()}`,
          referenceId: input.runId,
          actor: context.manager.email,
          note: `Weekly List ${run.label}`,
        });
      }
      const eggs = await applyRunEggStock(input.runId, run.label, context.manager.email, tx);
      await tx
        .update(schema.packRuns)
        .set({ stockAppliedAt: new Date().toISOString(), stockAppliedBy: context.manager.email })
        .where(eq(schema.packRuns.id, input.runId));
      return {
        ok: true,
        products: requirements.length,
        kg: roundKg(requirements.reduce((sum, row) => sum + row.requiredKg, 0)),
        eggProducts: eggs.products,
        eggs: eggs.eggs,
      };
    });
  }),

  reverseRunStock: manager.input(z.object({ runId: id })).handler(async ({ input, context }) => {
    return db.transaction(async (tx) => {
      const count = await reverseRunStock(input.runId, context.manager.email, tx);
      if (!count) throw new ORPCError("CONFLICT", { message: "This report has not been applied to stock." });
      return { ok: true, products: count };
    });
  }),
};
