import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { base } from "../__core/app";
import { db } from "../database";
import * as schema from "../database/schema";
import { manager } from "../middleware/manager";
import { activeEmployee } from "../lib/broilers";
import {
  changeEggStock,
  changeMobileBirds,
  eggStockRegister,
  ensureLayerDefaults,
  mobileOrThrow,
} from "../lib/layers";

const id = z.number().int().positive();
const date = z.iso.date();
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

function assertLogDate(value: string) {
  if (value > today()) {
    throw new ORPCError("BAD_REQUEST", { message: "You cannot log a future date." });
  }
}

async function loadCollections(limit = 120) {
  return db
    .select({
      collection: schema.eggCollections,
      mobile: schema.eggMobiles.name,
      employee: schema.farmEmployees.name,
    })
    .from(schema.eggCollections)
    .innerJoin(schema.eggMobiles, eq(schema.eggMobiles.id, schema.eggCollections.mobileId))
    .leftJoin(schema.farmEmployees, eq(schema.farmEmployees.id, schema.eggCollections.employeeId))
    .orderBy(desc(schema.eggCollections.collectionDate), desc(schema.eggCollections.id))
    .limit(limit);
}

async function loadBirdEvents(limit = 100) {
  return db
    .select({
      event: schema.layerBirdEvents,
      mobile: schema.eggMobiles.name,
      toMobile: sql<string | null>`(select name from egg_mobiles where id = ${schema.layerBirdEvents.toMobileId})`,
      employee: schema.farmEmployees.name,
    })
    .from(schema.layerBirdEvents)
    .innerJoin(schema.eggMobiles, eq(schema.eggMobiles.id, schema.layerBirdEvents.mobileId))
    .leftJoin(schema.farmEmployees, eq(schema.farmEmployees.id, schema.layerBirdEvents.employeeId))
    .orderBy(desc(schema.layerBirdEvents.id))
    .limit(limit);
}

async function loadEggStockProducts() {
  await ensureLayerDefaults();
  return db
    .select({ stock: schema.eggStockProducts, product: schema.products })
    .from(schema.eggStockProducts)
    .innerJoin(schema.products, eq(schema.products.id, schema.eggStockProducts.productId))
    .orderBy(asc(schema.products.sku));
}

async function loadStockMovements(limit = 100) {
  return db
    .select({ movement: schema.eggStockMovements, employee: schema.farmEmployees.name })
    .from(schema.eggStockMovements)
    .leftJoin(schema.farmEmployees, eq(schema.farmEmployees.id, schema.eggStockMovements.employeeId))
    .orderBy(desc(schema.eggStockMovements.id))
    .limit(limit);
}

/** Unvoided collections per mobile for the last `days` days, for the employee log's per-mobile cards. */
async function loadRecentByMobile(days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return db
    .select()
    .from(schema.eggCollections)
    .where(and(isNull(schema.eggCollections.voidedAt), sql`${schema.eggCollections.collectionDate} >= ${since}`))
    .orderBy(desc(schema.eggCollections.collectionDate));
}

async function loadFeedHistory(limit = 100) {
  return db
    .select({
      movement: schema.layerFeedMovements,
      feed: schema.layerFeedTypes.name,
      mobile: schema.eggMobiles.name,
      employee: schema.farmEmployees.name,
    })
    .from(schema.layerFeedMovements)
    .innerJoin(
      schema.layerFeedTypes,
      eq(schema.layerFeedTypes.id, schema.layerFeedMovements.feedTypeId),
    )
    .leftJoin(schema.eggMobiles, eq(schema.eggMobiles.id, schema.layerFeedMovements.mobileId))
    .leftJoin(schema.farmEmployees, eq(schema.farmEmployees.id, schema.layerFeedMovements.employeeId))
    .orderBy(desc(schema.layerFeedMovements.id))
    .limit(limit);
}

async function loadFeedTypes() {
  await ensureLayerDefaults();
  return db
    .select()
    .from(schema.layerFeedTypes)
    .where(eq(schema.layerFeedTypes.active, true))
    .orderBy(asc(schema.layerFeedTypes.name));
}

export const layers = {
  /** Trusted shared-device logging options; employee names are selectors, not authentication. */
  logOptions: base.handler(async () => {
    await ensureLayerDefaults();
    const [employees, mobiles, stock, feedTypes] = await Promise.all([
      db
        .select()
        .from(schema.farmEmployees)
        .where(eq(schema.farmEmployees.active, true))
        .orderBy(asc(schema.farmEmployees.name)),
      db
        .select()
        .from(schema.eggMobiles)
        .where(eq(schema.eggMobiles.active, true))
        .orderBy(asc(schema.eggMobiles.name)),
      eggStockRegister(),
      loadFeedTypes(),
    ]);
    const recent = await loadRecentByMobile();
    return {
      today: today(),
      employees,
      mobiles: mobiles.map((mobile) => ({
        ...mobile,
        todayCollection: recent.find(
          (row) => row.mobileId === mobile.id && row.collectionDate === today(),
        ) ?? null,
        recentCollections: recent.filter((row) => row.mobileId === mobile.id),
      })),
      eggStock: stock,
      feedTypes,
    };
  }),

  overview: manager.handler(async () => {
    await ensureLayerDefaults();
    const [mobiles, collections, birdEvents, stock, stockProducts, stockMovements, feedTypes, feedHistory] =
      await Promise.all([
        db.select().from(schema.eggMobiles).orderBy(asc(schema.eggMobiles.name)),
        loadCollections(),
        loadBirdEvents(),
        eggStockRegister(),
        loadEggStockProducts(),
        loadStockMovements(),
        loadFeedTypes(),
        loadFeedHistory(),
      ]);
    const totalBirds = mobiles.reduce((sum, mobile) => sum + mobile.birdCount, 0);
    const todayRows = collections.filter(
      (row) => !row.collection.voidedAt && row.collection.collectionDate === today(),
    );
    return {
      today: today(),
      mobiles,
      collections,
      birdEvents,
      eggStock: stock,
      stockProducts: stockProducts.map((row) => ({ ...row.stock, product: row.product })),
      stockMovements,
      feedTypes,
      feedHistory,
      stats: {
        birds: totalBirds,
        laidToday: todayRows.reduce((sum, row) => sum + row.collection.laid, 0),
        saleableToday: todayRows.reduce((sum, row) => sum + row.collection.saleable, 0),
        brokenToday: todayRows.reduce((sum, row) => sum + row.collection.broken, 0),
      },
    };
  }),

  /** Daily egg collection: laid is always exactly saleable + broken; saleable goes into egg stock. */
  logCollection: base
    .input(
      z.object({
        employeeId: id,
        mobileId: id,
        collectionDate: date,
        laid: z.number().int().min(0).max(100000),
        saleable: z.number().int().min(0).max(100000),
        broken: z.number().int().min(0).max(100000),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .handler(async ({ input }) => {
      assertLogDate(input.collectionDate);
      const [employee, mobile] = await Promise.all([
        activeEmployee(input.employeeId),
        mobileOrThrow(input.mobileId),
      ]);
      if (input.laid !== input.saleable + input.broken) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Eggs laid (${input.laid}) must equal saleable (${input.saleable}) + broken (${input.broken}).`,
        });
      }
      return db.transaction(async (tx) => {
        const [duplicate] = await tx
          .select({ id: schema.eggCollections.id })
          .from(schema.eggCollections)
          .where(
            and(
              eq(schema.eggCollections.mobileId, mobile.id),
              eq(schema.eggCollections.collectionDate, input.collectionDate),
              isNull(schema.eggCollections.voidedAt),
            ),
          );
        if (duplicate) {
          throw new ORPCError("CONFLICT", {
            message: `${mobile.name} already has a collection for ${input.collectionDate}. Ask the manager to void it first.`,
          });
        }
        const [collection] = await tx
          .insert(schema.eggCollections)
          .values({
            mobileId: mobile.id,
            collectionDate: input.collectionDate,
            laid: input.laid,
            saleable: input.saleable,
            broken: input.broken,
            employeeId: employee.id,
            actor: employee.name,
            note: input.note,
          })
          .returning();
        let eggsOnHand: number | null = null;
        if (input.saleable > 0) {
          const stock = await changeEggStock(tx, input.saleable, {
            kind: "collection",
            quantityEggs: input.saleable,
            referenceKey: `collection:${collection.id}`,
            referenceId: collection.id,
            employeeId: employee.id,
            actor: employee.name,
            note: `${mobile.name} collection`,
          });
          eggsOnHand = stock.eggsOnHand;
        } else {
          eggsOnHand = (await eggStockRegister(tx)).eggsOnHand;
        }
        return { collectionId: collection.id, eggsOnHand };
      });
    }),

  /** Layer flock ledger: arrivals into a mobile, deaths, and moves between mobiles. */
  logBirdEvent: base
    .input(
      z.object({
        employeeId: id,
        kind: z.enum(["arrival", "death", "move"]),
        mobileId: id,
        toMobileId: id.nullable().optional(),
        eventDate: date,
        count: z.number().int().positive().max(100000),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .handler(async ({ input }) => {
      assertLogDate(input.eventDate);
      const [employee, mobile] = await Promise.all([
        activeEmployee(input.employeeId),
        mobileOrThrow(input.mobileId),
      ]);
      if (input.kind === "move") {
        if (!input.toMobileId) {
          throw new ORPCError("BAD_REQUEST", { message: "Choose the mobile the birds move into." });
        }
        if (input.toMobileId === input.mobileId) {
          throw new ORPCError("BAD_REQUEST", { message: "The destination mobile must differ from the source." });
        }
        await mobileOrThrow(input.toMobileId);
        if (input.count > mobile.birdCount) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Only ${mobile.birdCount} birds are in ${mobile.name}.`,
          });
        }
      }
      if ((input.kind === "death") && input.count > mobile.birdCount) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Only ${mobile.birdCount} birds are in ${mobile.name}.`,
        });
      }
      return db.transaction(async (tx) => {
        if (input.kind === "arrival") {
          await changeMobileBirds(tx, mobile.id, input.count);
        } else if (input.kind === "death") {
          await changeMobileBirds(tx, mobile.id, -input.count);
        } else {
          await changeMobileBirds(tx, mobile.id, -input.count);
          await changeMobileBirds(tx, input.toMobileId!, input.count);
        }
        const [event] = await tx
          .insert(schema.layerBirdEvents)
          .values({
            mobileId: mobile.id,
            toMobileId: input.kind === "move" ? input.toMobileId! : null,
            kind: input.kind,
            eventDate: input.eventDate,
            count: input.count,
            employeeId: employee.id,
            actor: employee.name,
            note: input.note,
          })
          .returning();
        return { eventId: event.id };
      });
    }),

  /** Layer feed deliveries into storage and withdrawals out to a mobile. */
  logFeed: base
    .input(
      z.object({
        employeeId: id,
        feedTypeId: id,
        revision: z.number().int().positive(),
        movementDate: date,
        kind: z.enum(["delivery", "withdrawal"]),
        bags: z.number().int().positive().max(10000),
        mobileId: id.nullable().optional(),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .handler(async ({ input }) => {
      assertLogDate(input.movementDate);
      const employee = await activeEmployee(input.employeeId);
      const [feed] = await db
        .select()
        .from(schema.layerFeedTypes)
        .where(
          and(
            eq(schema.layerFeedTypes.id, input.feedTypeId),
            eq(schema.layerFeedTypes.active, true),
          ),
        );
      if (!feed) throw new ORPCError("BAD_REQUEST", { message: "Choose an active feed type." });
      if (input.kind === "withdrawal" && input.bags > feed.bagsOnHand) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Only ${feed.bagsOnHand} bag${feed.bagsOnHand === 1 ? "" : "s"} of ${feed.name} remain.`,
        });
      }
      if (input.mobileId) await mobileOrThrow(input.mobileId);
      return db.transaction(async (tx) => {
        const next = input.kind === "delivery" ? feed.bagsOnHand + input.bags : feed.bagsOnHand - input.bags;
        const [updated] = await tx
          .update(schema.layerFeedTypes)
          .set({ bagsOnHand: next, revision: feed.revision + 1 })
          .where(
            and(
              eq(schema.layerFeedTypes.id, feed.id),
              eq(schema.layerFeedTypes.revision, input.revision),
              ...(input.kind === "withdrawal" ? [gte(schema.layerFeedTypes.bagsOnHand, input.bags)] : []),
            ),
          )
          .returning();
        if (!updated) {
          throw new ORPCError("CONFLICT", {
            message: "The feed register changed on another device. Refresh and try again.",
          });
        }
        const [movement] = await tx
          .insert(schema.layerFeedMovements)
          .values({
            feedTypeId: feed.id,
            kind: input.kind,
            movementDate: input.movementDate,
            bags: input.bags,
            mobileId: input.kind === "withdrawal" ? (input.mobileId ?? null) : null,
            employeeId: employee.id,
            actor: employee.name,
            note: input.note,
          })
          .returning();
        return { movementId: movement.id, bagsOnHand: next };
      });
    }),

  /** Manager: void a feed movement — restores the bags it moved. */
  voidFeedMovement: manager
    .input(z.object({ movementId: id, reason: z.string().trim().min(3).max(500) }))
    .handler(async ({ input, context }) => {
      const [movement] = await db
        .select()
        .from(schema.layerFeedMovements)
        .where(eq(schema.layerFeedMovements.id, input.movementId));
      if (!movement) throw new ORPCError("NOT_FOUND", { message: "Feed movement not found." });
      if (movement.voidedAt) {
        throw new ORPCError("CONFLICT", { message: "This feed movement is already voided." });
      }
      return db.transaction(async (tx) => {
        const [feed] = await tx
          .select()
          .from(schema.layerFeedTypes)
          .where(eq(schema.layerFeedTypes.id, movement.feedTypeId));
        if (!feed) throw new ORPCError("NOT_FOUND", { message: "Feed type not found." });
        const delta = movement.kind === "delivery" ? -movement.bags : movement.bags;
        if (delta < 0 && feed.bagsOnHand < movement.bags) {
          throw new ORPCError("CONFLICT", {
            message: "Those delivered bags have already been used. Correct the withdrawals first.",
          });
        }
        await tx
          .update(schema.layerFeedTypes)
          .set({ bagsOnHand: feed.bagsOnHand + delta, revision: feed.revision + 1 })
          .where(eq(schema.layerFeedTypes.id, feed.id));
        const [voided] = await tx
          .update(schema.layerFeedMovements)
          .set({
            voidedAt: new Date().toISOString(),
            voidedBy: context.manager.email,
            voidReason: input.reason,
          })
          .where(
            and(
              eq(schema.layerFeedMovements.id, movement.id),
              isNull(schema.layerFeedMovements.voidedAt),
            ),
          )
          .returning();
        if (!voided) throw new ORPCError("CONFLICT", { message: "This movement changed. Refresh." });
        return { ok: true, bagsOnHand: feed.bagsOnHand + delta };
      });
    }),

  /** Manager: void a collection — removes its saleable eggs from stock (blocked if already sold). */
  voidCollection: manager
    .input(z.object({ collectionId: id, reason: z.string().trim().min(3).max(500) }))
    .handler(async ({ input, context }) => {
      const [collection] = await db
        .select()
        .from(schema.eggCollections)
        .where(eq(schema.eggCollections.id, input.collectionId));
      if (!collection) throw new ORPCError("NOT_FOUND", { message: "Egg collection not found." });
      if (collection.voidedAt) {
        throw new ORPCError("CONFLICT", { message: "This collection is already voided." });
      }
      return db.transaction(async (tx) => {
        const stock = await eggStockRegister(tx);
        if (collection.saleable > 0 && stock.eggsOnHand < collection.saleable) {
          throw new ORPCError("CONFLICT", {
            message: "Those saleable eggs have already been sold. Correct the stock first.",
          });
        }
        const [voided] = await tx
          .update(schema.eggCollections)
          .set({
            voidedAt: new Date().toISOString(),
            voidedBy: context.manager.email,
            voidReason: input.reason,
          })
          .where(
            and(
              eq(schema.eggCollections.id, collection.id),
              isNull(schema.eggCollections.voidedAt),
            ),
          )
          .returning();
        if (!voided) throw new ORPCError("CONFLICT", { message: "This collection changed. Refresh." });
        if (collection.saleable > 0) {
          await changeEggStock(tx, -collection.saleable, {
            kind: "collection_reversal",
            quantityEggs: -collection.saleable,
            referenceKey: `collection-reversal:${collection.id}`,
            referenceId: collection.id,
            actor: context.manager.email,
            note: `Voided collection ${collection.collectionDate}`,
          });
        }
        return { ok: true };
      });
    }),

  /** Manager: void a bird event — reverses its count changes on the mobiles involved. */
  voidBirdEvent: manager
    .input(z.object({ eventId: id, reason: z.string().trim().min(3).max(500) }))
    .handler(async ({ input, context }) => {
      const [event] = await db
        .select()
        .from(schema.layerBirdEvents)
        .where(eq(schema.layerBirdEvents.id, input.eventId));
      if (!event) throw new ORPCError("NOT_FOUND", { message: "Bird event not found." });
      if (event.voidedAt) {
        throw new ORPCError("CONFLICT", { message: "This bird event is already voided." });
      }
      return db.transaction(async (tx) => {
        if (event.kind === "arrival") {
          await changeMobileBirds(tx, event.mobileId, -event.count);
        } else if (event.kind === "death") {
          await changeMobileBirds(tx, event.mobileId, event.count);
        } else {
          await changeMobileBirds(tx, event.toMobileId!, -event.count);
          await changeMobileBirds(tx, event.mobileId, event.count);
        }
        const [voided] = await tx
          .update(schema.layerBirdEvents)
          .set({
            voidedAt: new Date().toISOString(),
            voidedBy: context.manager.email,
            voidReason: input.reason,
          })
          .where(
            and(
              eq(schema.layerBirdEvents.id, event.id),
              isNull(schema.layerBirdEvents.voidedAt),
            ),
          )
          .returning();
        if (!voided) throw new ORPCError("CONFLICT", { message: "This event changed. Refresh." });
        return { ok: true };
      });
    }),

  saveMobile: manager
    .input(
      z.object({
        id: id.optional(),
        name: z.string().trim().min(1).max(100),
        active: z.boolean().default(true),
      }),
    )
    .handler(async ({ input }) => {
      await ensureLayerDefaults();
      try {
        if (input.id) {
          const [existing] = await db
            .select()
            .from(schema.eggMobiles)
            .where(eq(schema.eggMobiles.id, input.id));
          if (!existing) throw new ORPCError("NOT_FOUND", { message: "Egg mobile not found." });
          return await db
            .update(schema.eggMobiles)
            .set({ name: input.name, active: input.active })
            .where(eq(schema.eggMobiles.id, input.id))
            .returning();
        }
        return await db.insert(schema.eggMobiles).values({ name: input.name }).returning();
      } catch (error) {
        if (error instanceof ORPCError) throw error;
        throw new ORPCError("CONFLICT", { message: "An egg mobile with this name already exists." });
      }
    }),

  saveEggProduct: manager
    .input(
      z.object({
        productId: id,
        enabled: z.boolean(),
        eggsPerUnit: z.number().int().positive().max(1000),
      }),
    )
    .handler(async ({ input }) => {
      await ensureLayerDefaults();
      const [row] = await db
        .select({ stock: schema.eggStockProducts, product: schema.products })
        .from(schema.eggStockProducts)
        .innerJoin(schema.products, eq(schema.products.id, schema.eggStockProducts.productId))
        .where(eq(schema.eggStockProducts.productId, input.productId));
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Egg stock product not found." });
      const [updated] = await db
        .update(schema.eggStockProducts)
        .set({ enabled: input.enabled, eggsPerUnit: input.eggsPerUnit })
        .where(eq(schema.eggStockProducts.productId, input.productId))
        .returning();
      return updated;
    }),

  /** Manager: manual stock correction, e.g. eggs used on the farm or given away. */
  adjustStock: manager
    .input(
      z.object({
        revision: z.number().int().positive(),
        delta: z.number().int().min(-100000).max(100000),
        note: z.string().trim().min(3).max(500),
      }),
    )
    .handler(async ({ input, context }) => {
      if (input.delta === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "The adjustment cannot be zero." });
      }
      return db.transaction(async (tx) => {
        const updated = await changeEggStock(
          tx,
          input.delta,
          {
            kind: "adjustment",
            quantityEggs: input.delta,
            referenceKey: `adjustment:${crypto.randomUUID()}`,
            actor: context.manager.email,
            note: input.note,
          },
          input.revision,
        );
        return { eggsOnHand: updated.eggsOnHand, revision: updated.revision };
      });
    }),
};
