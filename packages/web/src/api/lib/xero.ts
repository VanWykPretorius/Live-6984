import { toCsv } from "./csv";

/** Exact column order of Xero's SalesInvoiceTemplate.csv. */
export const XERO_HEADERS = [
  "*ContactName",
  "EmailAddress",
  "POAddressLine1",
  "POAddressLine2",
  "POAddressLine3",
  "POAddressLine4",
  "POCity",
  "PORegion",
  "POPostalCode",
  "POCountry",
  "*InvoiceNumber",
  "Reference",
  "*InvoiceDate",
  "*DueDate",
  "Total",
  "InventoryItemCode",
  "*Description",
  "*Quantity",
  "*UnitAmount",
  "Discount",
  "*AccountCode",
  "*TaxType",
  "TaxAmount",
  "TrackingName1",
  "TrackingOption1",
  "TrackingName2",
  "TrackingOption2",
  "Currency",
  "BrandingTheme",
];

export type XeroInvoiceLine = {
  itemCode?: string | null;
  description: string;
  quantity: number;
  unitAmount: number;
  discount?: number | null;
  accountCode?: string | null;
  taxType?: string | null;
  trackingOption?: string | null;
};

export type XeroInvoice = {
  contactName: string;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  invoiceNumber: string;
  reference?: string | null;
  invoiceDate: string; // ISO yyyy-MM-dd
  dueDate: string; // ISO yyyy-MM-dd
  currency?: string | null;
  brandingTheme?: string | null;
  lines: XeroInvoiceLine[];
};

export function formatDate(iso: string, format: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  switch (format) {
    case "yyyy-MM-dd":
      return `${y}-${m}-${d}`;
    case "MM/dd/yyyy":
      return `${m}/${d}/${y}`;
    case "dd/MM/yyyy":
    default:
      return `${d}/${m}/${y}`;
  }
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function invoiceTotal(inv: XeroInvoice): number {
  return invoiceLinesTotal(inv.lines);
}

/** Match the exported unit precision and Xero's per-line monetary rounding. */
export function invoiceLinesTotal(lines: XeroInvoiceLine[]): number {
  return round2(
    lines.reduce(
      (sum, l) => sum + round2(l.quantity * round2(l.unitAmount) * (1 - (l.discount ?? 0) / 100)),
      0,
    ),
  );
}

/**
 * Xero bulk import: one row per line, invoice-level fields repeated on the first row of
 * each invoice (Xero accepts them repeated; contact/date columns on the first row define
 * the invoice and the rest of the rows attach to the same invoice number).
 */
export function buildXeroCsv(
  invoices: XeroInvoice[],
  opts: {
    dateFormat: string;
    currency: string;
    brandingTheme?: string | null;
    /** Xero tracking category name; without it the tracking columns stay blank. */
    trackingCategoryName?: string | null;
  },
): string {
  const rows: (string | number | null)[][] = [];
  const category = opts.trackingCategoryName?.trim() || "";
  for (const inv of invoices) {
    inv.lines.forEach((line, index) => {
      rows.push([
        inv.contactName,
        index === 0 ? (inv.email ?? "") : "",
        index === 0 ? (inv.addressLine1 ?? "") : "",
        index === 0 ? (inv.addressLine2 ?? "") : "",
        "",
        "",
        index === 0 ? (inv.city ?? "") : "",
        index === 0 ? (inv.region ?? "") : "",
        index === 0 ? (inv.postalCode ?? "") : "",
        index === 0 ? (inv.country ?? "") : "",
        inv.invoiceNumber,
        inv.reference ?? "",
        formatDate(inv.invoiceDate, opts.dateFormat),
        formatDate(inv.dueDate, opts.dateFormat),
        index === 0 ? invoiceTotal(inv).toFixed(2) : "",
        line.itemCode ?? "",
        line.description,
        line.quantity,
        round2(line.unitAmount).toFixed(2),
        line.discount ? line.discount : "",
        line.accountCode ?? "",
        line.taxType ?? "",
        "",
        category && line.trackingOption ? category : "",
        category ? (line.trackingOption ?? "") : "",
        "",
        "",
        inv.currency ?? opts.currency,
        inv.brandingTheme ?? opts.brandingTheme ?? "",
      ]);
    });
  }
  return toCsv(XERO_HEADERS, rows);
}
