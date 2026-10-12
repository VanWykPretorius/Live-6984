import { eq } from "drizzle-orm";
import { z } from "zod";
import { manager as base } from "../middleware/manager";
import { db } from "../database";
import * as schema from "../database/schema";
import { getSettings, randomKey } from "../lib/settings";

const updateSchema = z.object({
  dueDays: z.number().int().min(0).max(365),
  dateFormat: z.enum(["dd/MM/yyyy", "yyyy-MM-dd", "MM/dd/yyyy"]),
  defaultAccountCode: z.string(),
  defaultTaxType: z.string(),
  trackingCategoryName: z.string(),
  defaultTrackingOption: z.string(),
  currency: z.string(),
  brandingTheme: z.string().nullable().optional(),
  orderInvoicePrefix: z
    .string()
    .refine((prefix) => prefix !== "INV-", "INV- is reserved for combined invoices."),
  subscriptionInvoicePrefix: z
    .string()
    .refine((prefix) => prefix !== "INV-", "INV- is reserved for combined invoices."),
  shippingSku: z.string(),
  shippingDescription: z.string(),
  shippingAccountCode: z.string(),
  shippingTaxType: z.string(),
  shippingTrackingOption: z.string(),
  discountSku: z.string(),
  discountDescription: z.string(),
  discountTrackingOption: z.string(),
  defaultBoxSku: z.string(),
  defaultBoxPrice: z.number(),
  defaultShippingAmount: z.number(),
});

export const settings = {
  get: base.handler(() => getSettings()),

  update: base.input(updateSchema).handler(async ({ input }) => {
    await getSettings();
    const [row] = await db
      .update(schema.settings)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.settings.id, 1))
      .returning();
    return row;
  }),

  rotateApiKey: base.handler(async () => {
    await getSettings();
    const [row] = await db
      .update(schema.settings)
      .set({ apiKey: randomKey(), updatedAt: new Date() })
      .where(eq(schema.settings.id, 1))
      .returning();
    return row;
  }),
};
