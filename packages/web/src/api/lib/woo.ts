import { num, parseCsvRecords, pick, type CsvRecord } from "./csv";

export type ParsedItem = {
  rawText: string;
  rawName: string;
  sku: string | null;
  quantity: number;
};

export type ParsedOrder = {
  orderNumber: string;
  orderDate: string;
  websiteStatus: string;
  shippingMethod: string;
  customerNote: string;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  orderTotal: number;
  rawItems: string;
  customer: {
    name: string;
    company: string;
    email: string;
    phone: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  };
  items: ParsedItem[];
};

/**
 * A trailing parenthetical is only a SKU when it looks like a code (letters+digits, no
 * price/unit text) — the exports also carry pricing notes like "(R110/kg)" or "(500g)".
 */
const SKU_RE = /^[A-Z][A-Z0-9][A-Z0-9\-_/]*\d[A-Z0-9\-_/]*$/;

export function looksLikeSku(value: string): boolean {
  const v = value.trim();
  if (v.length < 3 || v.length > 24) return false;
  if (/\s/.test(v)) return false;
  if (/\//.test(v) && /kg|g|ml|l|each/i.test(v)) return false;
  if (/^r?\d+([.,]\d+)?$/i.test(v)) return false;
  return SKU_RE.test(v.toUpperCase()) && v === v.toUpperCase();
}

/** "30 x Pastured Eggs (NON-GMO) (EGG030) x2" -> name + sku + qty */
export function parseItemEntry(entry: string): ParsedItem | null {
  const rawText = entry.trim();
  if (!rawText) return null;

  let quantity = 1;
  let rest = rawText;
  const qtyMatch = rawText.match(/\s[x×]\s?(\d+(?:[.,]\d+)?)\s*$/i);
  if (qtyMatch) {
    quantity = Number.parseFloat(qtyMatch[1].replace(",", ".")) || 1;
    rest = rawText.slice(0, qtyMatch.index).trim();
  }

  let sku: string | null = null;
  const parenMatch = rest.match(/\(([^()]*)\)\s*$/);
  if (parenMatch && looksLikeSku(parenMatch[1])) {
    sku = parenMatch[1].trim().toUpperCase();
    rest = rest.slice(0, parenMatch.index).trim();
  }

  return { rawText, rawName: rest, sku, quantity };
}

export function parseItemsCell(cell: string): ParsedItem[] {
  if (!cell) return [];
  return cell
    .split("|")
    .map((part) => parseItemEntry(part))
    .filter((i): i is ParsedItem => i !== null && i.rawName !== "");
}

function toIsoDate(value: string): string {
  const v = (value || "").trim();
  if (!v) return new Date().toISOString().slice(0, 10);
  const iso = v.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function recordToOrder(rec: CsvRecord): ParsedOrder | null {
  const orderNumber = pick(rec, "Order Number", "Order ID", "order_number", "id", "number");
  if (!orderNumber) return null;
  const rawItems = pick(rec, "Items", "Line Items", "items");
  return {
    orderNumber,
    orderDate: toIsoDate(pick(rec, "Date Created", "Date Paid", "date", "created_at")),
    websiteStatus: pick(rec, "Status", "status"),
    shippingMethod: pick(rec, "Shipping Method", "shipping_method"),
    customerNote: pick(rec, "Customer Note", "customer_note"),
    discountTotal: num(pick(rec, "Discount Total", "discount_total")),
    shippingTotal: num(pick(rec, "Shipping Total", "shipping_total")),
    taxTotal: num(pick(rec, "Tax Total", "tax_total")),
    orderTotal: num(pick(rec, "Order Total", "order_total", "total")),
    rawItems,
    customer: {
      name: pick(rec, "Billing Name", "billing_name", "Shipping Name", "Customer Name"),
      company: pick(rec, "Billing Company", "billing_company"),
      email: pick(rec, "Billing Email", "billing_email", "email"),
      phone: pick(rec, "Billing Phone", "billing_phone", "phone"),
      addressLine1: pick(rec, "Billing Address", "Billing Address 1", "billing_address_1"),
      addressLine2: pick(rec, "Billing Address 2", "billing_address_2"),
      city: pick(rec, "Billing City", "billing_city"),
      region: pick(rec, "Billing State", "billing_state"),
      postalCode: pick(rec, "Billing Postcode", "billing_postcode"),
      country: pick(rec, "Billing Country", "billing_country"),
    },
    items: parseItemsCell(rawItems),
  };
}

export function parseWooOrdersCsv(csv: string): ParsedOrder[] {
  const { records } = parseCsvRecords(csv);
  return records.map(recordToOrder).filter((o): o is ParsedOrder => o !== null);
}

/** Shape accepted by the /api/ingest/orders endpoint (WooCommerce webhook or custom JSON). */
export function parseJsonOrder(payload: Record<string, unknown>): ParsedOrder | null {
  const get = (...keys: string[]): string => {
    for (const k of keys) {
      const parts = k.split(".");
      let cur: unknown = payload;
      for (const p of parts) {
        if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p];
        } else {
          cur = undefined;
          break;
        }
      }
      if (cur !== undefined && cur !== null && String(cur) !== "") return String(cur);
    }
    return "";
  };

  const orderNumber = get("number", "order_number", "id");
  if (!orderNumber) {
    // Not a WooCommerce-shaped order — accept a row from the CSV export posted as JSON.
    const flat: CsvRecord = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v !== null && v !== undefined && typeof v !== "object") flat[k] = String(v);
    }
    return Object.keys(flat).length > 0 ? recordToOrder(flat) : null;
  }

  const rawLines = (payload.line_items ?? payload.items ?? []) as Array<Record<string, unknown>>;
  const items: ParsedItem[] = Array.isArray(rawLines)
    ? rawLines.map((li) => {
        const name = String(li.name ?? li.description ?? "").trim();
        const sku = String(li.sku ?? "").trim();
        const qty = Number(li.quantity ?? li.qty ?? 1) || 1;
        return {
          rawText: `${name}${sku ? ` (${sku})` : ""} x${qty}`,
          rawName: name,
          sku: sku ? sku.toUpperCase() : null,
          quantity: qty,
        };
      })
    : [];

  const shippingLines = (payload.shipping_lines ?? []) as Array<Record<string, unknown>>;
  const shippingTotal = Array.isArray(shippingLines)
    ? shippingLines.reduce((sum, s) => sum + (Number(s.total) || 0), 0)
    : Number(get("shipping_total")) || 0;

  return {
    orderNumber,
    orderDate: toIsoDate(get("date_created", "date_paid", "date")),
    websiteStatus: get("status"),
    shippingMethod: Array.isArray(shippingLines)
      ? String(shippingLines[0]?.method_title ?? "")
      : get("shipping_method"),
    customerNote: get("customer_note"),
    discountTotal: Number(get("discount_total")) || 0,
    shippingTotal,
    taxTotal: Number(get("total_tax", "tax_total")) || 0,
    orderTotal: Number(get("total", "order_total")) || 0,
    rawItems: items.map((i) => i.rawText).join(" | "),
    customer: {
      name:
        `${get("billing.first_name")} ${get("billing.last_name")}`.trim() ||
        get("billing.company", "customer_name"),
      company: get("billing.company"),
      email: get("billing.email", "email"),
      phone: get("billing.phone"),
      addressLine1: get("billing.address_1"),
      addressLine2: get("billing.address_2"),
      city: get("billing.city"),
      region: get("billing.state"),
      postalCode: get("billing.postcode"),
      country: get("billing.country"),
    },
    items,
  };
}
