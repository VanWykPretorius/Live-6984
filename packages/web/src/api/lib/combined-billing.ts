import { ORPCError } from "@orpc/server";
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import {
  customerFields,
  dueDeliveries,
  shippingItem,
  subscriptionInvoice,
} from "../routes/billing";
import { getSettings } from "./settings";
import { addDays, invoiceTotal, invoiceLinesTotal, round2, type XeroInvoice } from "./xero";
import type { BillingDb } from "./billing-db";
import { reserveInvoiceSequence } from "./invoice-sequences";

export type BillingSelection = {
  from: string;
  to: string;
  invoiceDate: string;
  orderIds: number[];
  deliveries: { subscriptionId: number; deliveryDate: string }[];
};

export type BillingSource = {
  key: string;
  type: "order" | "delivery";
  orderId: number | null;
  subscriptionId: number | null;
  date: string;
  label: string;
  customer: typeof schema.customers.$inferSelect | null;
  customerKey: string;
  lines: XeroInvoice["lines"];
  total: number;
  blocked: string[];
};

export function billingCustomerKey(customer: BillingSource["customer"], fallback: string) {
  if (!customer) return `missing:${fallback}`;
  const email = customer.email?.trim().toLowerCase();
  return email ? `email:${email}` : `customer:${customer.id}`;
}

function lineProblems(lines: XeroInvoice["lines"]) {
  const problems: string[] = [];
  for (const line of lines) {
    if (!line.description.trim()) problems.push("blank line description");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) problems.push("invalid quantity");
    if (!Number.isFinite(line.unitAmount)) problems.push("invalid amount");
    if (!line.accountCode?.trim()) problems.push("missing account code");
    if (!line.taxType?.trim()) problems.push("missing tax type");
  }
  return problems;
}

/** The same catalog/accounting preparation serves selection, review and final generation. */
export async function loadCombinedSources(from: string, to: string, database: BillingDb = db) {
  const settings = await getSettings(database);
  const ship = await shippingItem(settings, database);
  const deliveries = await dueDeliveries(from, to, database);
  const sources: BillingSource[] = deliveries.map((row) => {
    const inv = subscriptionInvoice(row.sub, row.deliveryDate, "", settings, ship);
    const label = `Box delivery ${row.deliveryDate}${row.sub.reference ? ` · ${row.sub.reference}` : ""}`;
    const lines = inv.lines.map((line) => ({
      ...line,
      unitAmount: round2(line.unitAmount),
      description: `${line.description} — ${label}`,
    }));
    const blocked = [...row.blocked, ...lineProblems(inv.lines)];
    if (row.sub.addons.some((a) => (a.effectivePrice ?? 0) <= 0))
      blocked.push("add-on has no positive price");
    if (row.sub.boxPrice <= 0) blocked.push("box has no positive price");
    if (row.sub.shippingAmount < 0) blocked.push("negative shipping amount");
    if (!inv.contactName.trim()) blocked.push("missing customer name");
    return {
      key: `delivery:${row.sub.id}:${row.deliveryDate}`,
      type: "delivery" as const,
      orderId: null,
      subscriptionId: row.sub.id,
      date: row.deliveryDate,
      label,
      customer: row.sub.customer,
      customerKey: billingCustomerKey(row.sub.customer, String(row.sub.id)),
      lines,
      total: invoiceLinesTotal(lines),
      blocked: [...new Set(blocked)],
    };
  });
  // Website orders are deliberately not filtered by the delivery period.
  const orderRows = await database
    .select({ order: schema.orders, customer: schema.customers })
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .where(eq(schema.orders.invoiceStatus, "pending"));
  const ids = orderRows.map((r) => r.order.id);
  const orderLines = ids.length
    ? await database
        .select({ line: schema.orderLines, product: schema.products })
        .from(schema.orderLines)
        .leftJoin(schema.products, eq(schema.orderLines.productId, schema.products.id))
        .where(inArray(schema.orderLines.orderId, ids))
    : [];
  for (const { order, customer } of orderRows.sort((a, b) =>
    a.order.orderNumber.localeCompare(b.order.orderNumber),
  )) {
    const items = orderLines.filter(
      (r) => r.line.orderId === order.id && r.line.status !== "ignored",
    );
    const blocked: string[] = [];
    if (!customer || !customerFields(customer).contactName.trim()) blocked.push("missing customer");
    if (!items.length) blocked.push("no billable lines");
    const label = `Website order #${order.orderNumber}`;
    const lines: XeroInvoice["lines"] = items.map(({ line, product }) => {
      const price = line.unitPrice ?? product?.unitPrice;
      if (!line.description.trim()) blocked.push("blank item description");
      if (line.status !== "matched" || !product)
        blocked.push(`${line.rawName || line.description} is unmatched`);
      if (price == null || price <= 0)
        blocked.push(`${line.sku || line.description} has no positive price`);
      return {
        itemCode: product?.sku || line.sku,
        description: `${line.description} — ${label}`,
        quantity: line.quantity,
        unitAmount: round2(price ?? 0),
        accountCode: product?.accountCode || settings.defaultAccountCode,
        taxType: product?.taxType || settings.defaultTaxType,
        trackingOption: product?.trackingOption || settings.defaultTrackingOption,
      };
    });
    if (order.shippingTotal < 0 || order.discountTotal < 0)
      blocked.push("negative shipping or discount");
    if (order.shippingTotal > 0)
      lines.push({
        ...ship,
        quantity: 1,
        unitAmount: round2(order.shippingTotal),
        description: `${ship.description}${order.shippingMethod ? ` — ${order.shippingMethod}` : ""} — ${label}`,
      });
    if (order.discountTotal > 0)
      lines.push({
        itemCode: settings.discountSku || null,
        description: `${settings.discountDescription} — ${label}`,
        quantity: 1,
        unitAmount: -round2(order.discountTotal),
        accountCode: settings.defaultAccountCode,
        taxType: settings.defaultTaxType,
        trackingOption: settings.discountTrackingOption || settings.defaultTrackingOption,
      });
    blocked.push(...lineProblems(lines));
    const total = invoiceLinesTotal(lines);
    if (total < 0) blocked.push("negative invoice value");
    sources.push({
      key: `order:${order.id}`,
      type: "order",
      orderId: order.id,
      subscriptionId: null,
      date: order.orderDate,
      label,
      customer,
      customerKey: billingCustomerKey(customer, String(order.id)),
      lines,
      total,
      blocked: [...new Set(blocked)],
    });
  }
  return { sources, settings };
}

/** Never silently drop a stale, missing, duplicated or newly blocked source. */
export async function prepareCombined(input: BillingSelection, database: BillingDb = db) {
  const keys = [
    ...input.orderIds.map((id) => `order:${id}`),
    ...input.deliveries.map((d) => `delivery:${d.subscriptionId}:${d.deliveryDate}`),
  ].sort();
  if (!keys.length)
    throw new ORPCError("BAD_REQUEST", { message: "Select at least one order or delivery." });
  if (new Set(keys).size !== keys.length)
    throw new ORPCError("BAD_REQUEST", {
      message: "Duplicate selection. Refresh and select each source once.",
    });
  const { sources, settings } = await loadCombinedSources(input.from, input.to, database);
  const selected = keys.map((key) => sources.find((source) => source.key === key));
  if (selected.some((s) => !s))
    throw new ORPCError("CONFLICT", {
      message:
        "A selected order or delivery is no longer billable. Refresh the selection; nothing was generated.",
    });
  const chosen = selected as BillingSource[];
  const problems = chosen.filter((s) => s.blocked.length);
  if (problems.length)
    throw new ORPCError("BAD_REQUEST", {
      message: `Nothing generated. Fix: ${problems.map((s) => `${s.label}: ${s.blocked.join(", ")}`).join("; ")}`,
    });

  const grouped = new Map<string, BillingSource[]>();
  for (const source of chosen)
    grouped.set(source.customerKey, [...(grouped.get(source.customerKey) ?? []), source]);
  const invoices = [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([customerKey, group]) => {
      // Stable canonical contact: subscription first, then the lowest customer ID.
      const ordered = [...group].sort(
        (a, b) =>
          (a.type === "delivery" ? 0 : 1) - (b.type === "delivery" ? 0 : 1) ||
          (a.customer?.id ?? 0) - (b.customer?.id ?? 0) ||
          a.key.localeCompare(b.key),
      );
      const contact = ordered[0].customer!;
      const fields = customerFields(contact);
      const invoice: XeroInvoice = {
        ...fields,
        email: contact.email?.trim() || null,
        invoiceNumber: "",
        reference: ordered.map((s) => s.label).join("; "),
        invoiceDate: input.invoiceDate,
        dueDate: addDays(input.invoiceDate, settings.dueDays),
        currency: settings.currency,
        brandingTheme: settings.brandingTheme,
        lines: ordered.flatMap((s) => s.lines),
      };
      const matchedCustomers = [
        ...new Map(
          ordered.map((s) => [
            s.customer!.id,
            {
              id: s.customer!.id,
              name: customerFields(s.customer!).contactName,
              email: s.customer!.email,
            },
          ]),
        ).values(),
      ];
      return {
        customerKey,
        invoice,
        sources: ordered,
        matchedCustomers,
        total: invoiceTotal(invoice),
      };
    });
  const total = round2(invoices.reduce((sum, i) => sum + i.total, 0));
  // Settings/source content is included so a reviewed amount/contact cannot silently change.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        input: {
          ...input,
          orderIds: [...input.orderIds].sort((a, b) => a - b),
          deliveries: [...input.deliveries].sort((a, b) =>
            `${a.subscriptionId}:${a.deliveryDate}`.localeCompare(
              `${b.subscriptionId}:${b.deliveryDate}`,
            ),
          ),
        },
        invoices,
        settings: {
          dueDays: settings.dueDays,
          dateFormat: settings.dateFormat,
          currency: settings.currency,
          brandingTheme: settings.brandingTheme,
          trackingCategoryName: settings.trackingCategoryName,
        },
      }),
    )
    .digest("hex");
  return { invoices, settings, total, fingerprint };
}

/** Include stored/voided CSVs: voiding must not reuse a number that may exist in Xero. */
export async function nextCombinedSequence(database: BillingDb, invoiceCount: number) {
  return reserveInvoiceSequence("INV-", invoiceCount, database);
}
