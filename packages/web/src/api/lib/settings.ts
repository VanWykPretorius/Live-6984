import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import type { BillingDb } from "./billing-db";

export type Settings = typeof schema.settings.$inferSelect;

function randomKey(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}

/** Single settings row, created with defaults on first use. */
export async function getSettings(database: BillingDb = db): Promise<Settings> {
  const [row] = await database.select().from(schema.settings).where(eq(schema.settings.id, 1));
  if (row) return row;
  const [created] = await database
    .insert(schema.settings)
    .values({ id: 1, apiKey: randomKey() })
    .returning();
  return created;
}

export { randomKey };
