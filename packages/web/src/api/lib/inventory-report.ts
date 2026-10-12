import * as XLSX from "xlsx";
import { parseCsv } from "./csv";

/**
 * Reader for Xero's "Inventory Item Details" report, exported as .xlsx or .csv.
 *
 * The report is grouped rather than tabular: an item header row carries the SKU and item
 * name, the rows beneath it are the invoice lines, and a "Total …" row closes the group.
 *
 *   BEEF010 - Beef Brisket (kg) (Untracked)
 *   2026-10-01 | Receivable Invoice | WEB-0023 | Méri Steyn | Grass Fed Beef Brisket | -130.43 | -130.43 | -1.0
 *   Total BEEF010 - Beef Brisket (kg) (Untracked)
 *
 * Quantities come through as negative stock movements (a sale reduces quantity on hand),
 * so they are flipped to positive here — the lists care about how much left the farm.
 */

export type ReportLine = {
  sku: string;
  itemName: string;
  date: string;
  source: string;
  reference: string;
  contact: string;
  description: string;
  quantity: number;
  value: number;
};

export type ParsedReport = {
  periodFrom: string | null;
  periodTo: string | null;
  lines: ReportLine[];
  /** Item groups seen in the file, including any that had no lines. */
  skus: { sku: string; itemName: string }[];
};

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/** Month by full name or three-letter abbreviation: "September" and "Sep" both work. */
function monthNumber(name: string): string | null {
  const n = name.toLowerCase();
  if (MONTHS[n]) return MONTHS[n];
  const full = Object.keys(MONTHS).find((m) => m.startsWith(n.slice(0, 3)));
  return full ? MONTHS[full] : null;
}

/** "30 September 2026" or "01 Oct 2026" -> "2026-09-30" */
function parseLongDate(text: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text);
  if (!m) return null;
  const month = monthNumber(m[2]);
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
}

/** Any of Xero's date spellings, plus the ISO/serial forms xlsx hands back. */
function normaliseDate(value: string): string {
  const v = value.trim();
  if (!v) return "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  if (iso) return iso[1];
  const long = parseLongDate(v);
  if (long) return long;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (slash) return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  return v;
}

function toNumber(value: string): number {
  const cleaned = value.replace(/[(),\s]/g, "").replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Item header rows look like "SKU - Item name (Untracked)" and have no data in the
 * other columns, which is what separates them from invoice lines.
 */
function parseItemHeader(cells: string[]): { sku: string; itemName: string } | null {
  const first = (cells[0] ?? "").trim();
  if (!first || first.toLowerCase().startsWith("total")) return null;
  if (cells.slice(1).some((c) => c.trim() !== "")) return null;
  const m = /^([A-Za-z0-9._/-]+)\s+-\s+(.+)$/.exec(first);
  if (!m) return null;
  const itemName = m[2].replace(/\s*\((?:Un)?tracked\)\s*$/i, "").trim();
  return { sku: m[1].trim().toUpperCase(), itemName };
}

function rowsFromXlsx(bytes: Uint8Array): string[][] {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  return raw.map((r) => (r as unknown[]).map((c) => (c == null ? "" : String(c))));
}

/** Accepts the raw file: a base64 .xlsx payload, or CSV text. */
export function parseInventoryReport(input: { csv?: string; base64?: string }): ParsedReport {
  let rows: string[][];
  if (input.base64) {
    rows = rowsFromXlsx(Uint8Array.from(Buffer.from(input.base64, "base64")));
  } else {
    rows = parseCsv(input.csv ?? "");
  }

  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  const lines: ReportLine[] = [];
  const skus: { sku: string; itemName: string }[] = [];
  let current: { sku: string; itemName: string } | null = null;

  for (const row of rows) {
    const cells = row.map((c) => (c ?? "").trim());
    if (cells.every((c) => c === "")) continue;

    const joined = cells.join(" ");
    if (periodFrom === null && /for the period/i.test(joined)) {
      const parts = joined.split(/\bto\b/i);
      periodFrom = parseLongDate(parts[0] ?? "");
      periodTo = parts[1] ? parseLongDate(parts[1]) : null;
      continue;
    }

    // Column header row — skip it.
    if (/^date$/i.test(cells[0]) && cells.some((c) => /qoh|movement|reference/i.test(c))) continue;

    if (cells[0].toLowerCase().startsWith("total")) continue;

    const header = parseItemHeader(cells);
    if (header) {
      current = header;
      if (!skus.some((s) => s.sku === header.sku)) skus.push(header);
      continue;
    }

    if (!current) continue;

    // Invoice line: Date | Source | Reference | Contact | Description | Total | Value | QoH
    const qohRaw = cells[7] ?? "";
    const valueRaw = cells[6] ?? cells[5] ?? "";
    const quantity = Math.abs(toNumber(qohRaw));
    if (!qohRaw && !valueRaw) continue;

    lines.push({
      sku: current.sku,
      itemName: current.itemName,
      date: normaliseDate(cells[0] ?? ""),
      source: cells[1] ?? "",
      reference: cells[2] ?? "",
      contact: cells[3] ?? "",
      description: cells[4] ?? "",
      quantity,
      value: Math.abs(toNumber(valueRaw)),
    });
  }

  return { periodFrom, periodTo, lines, skus };
}
