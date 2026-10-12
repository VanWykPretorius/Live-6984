import { eq } from "drizzle-orm";
import * as schema from "../database/schema";
import type { BillingDb } from "./billing-db";
import { parseCsvRecords } from "./csv";

/** Call only inside the billing transaction; never recycle voided/deleted numbers. */
export async function reserveInvoiceSequence(
  prefix: string,
  invoiceCount: number,
  database: BillingDb,
) {
  const [sequence] = await database
    .select()
    .from(schema.invoiceSequences)
    .where(eq(schema.invoiceSequences.prefix, prefix));
  let highest = (sequence?.nextNumber ?? 1) - 1;
  const collect = (number: string | null) => {
    if (!number?.startsWith(prefix)) return;
    const suffix = number.slice(prefix.length);
    if (/^\d+$/.test(suffix)) highest = Math.max(highest, Number(suffix));
  };
  for (const row of await database
    .select({ number: schema.orders.invoiceNumber })
    .from(schema.orders))
    collect(row.number);
  for (const row of await database
    .select({ number: schema.deliveries.invoiceNumber })
    .from(schema.deliveries))
    collect(row.number);
  for (const row of await database
    .select({ csv: schema.invoiceBatches.csv })
    .from(schema.invoiceBatches)) {
    for (const record of parseCsvRecords(row.csv).records) collect(record["*InvoiceNumber"]);
  }
  const next = highest + 1;
  await database
    .insert(schema.invoiceSequences)
    .values({ prefix, nextNumber: next + invoiceCount })
    .onConflictDoUpdate({
      target: schema.invoiceSequences.prefix,
      set: { nextNumber: next + invoiceCount },
    });
  return next;
}
