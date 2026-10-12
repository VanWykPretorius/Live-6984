import { ORPCError } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { manager as base } from "../middleware/manager";
import { db } from "../database";
import * as schema from "../database/schema";

const customerInput = z.object({
  name: z.string().min(1),
  company: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
});

export const customers = {
  list: base.handler(() => db.select().from(schema.customers).orderBy(asc(schema.customers.name))),

  create: base.input(customerInput).handler(async ({ input }) => {
    const [row] = await db.insert(schema.customers).values(input).returning();
    return row;
  }),

  update: base
    .input(customerInput.partial().extend({ id: z.number() }))
    .handler(async ({ input }) => {
      const { id, ...values } = input;
      const [row] = await db
        .update(schema.customers)
        .set(values)
        .where(eq(schema.customers.id, id))
        .returning();
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Customer not found" });
      return row;
    }),

  remove: base.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    const subs = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.customerId, input.id));
    if (subs.length > 0) {
      throw new ORPCError("CONFLICT", {
        message: "Customer has subscriptions — remove those first.",
      });
    }
    await db.delete(schema.customers).where(eq(schema.customers.id, input.id));
    return { ok: true };
  }),
};
