/**
 * Which weekly list a SKU belongs on. Groups are derived from the SKU prefix so new
 * SKUs land on the right list automatically; a product row can override its own group
 * via `products.listGroup` when a SKU does not follow the prefix convention.
 */

export const LIST_GROUPS = [
  "harvest",
  "meat",
  "eggs",
  "veldwonder",
  "milkwood",
  "box",
  "shipping",
  "other",
] as const;

export type ListGroup = (typeof LIST_GROUPS)[number];

/** Longest prefix wins, so VEGBOX beats VEG. */
const PREFIX_GROUPS: [string, ListGroup][] = [
  ["VEGBOX", "box"],
  ["BOX", "box"],
  ["VEG", "harvest"],
  ["CHICK", "meat"],
  ["BEEF", "meat"],
  ["LAMB", "meat"],
  ["EGG", "eggs"],
  ["VW", "veldwonder"],
  ["MW", "milkwood"],
  ["SHIP", "shipping"],
  ["DISC", "other"],
];

export function groupForSku(sku: string): ListGroup {
  const s = sku.trim().toUpperCase();
  let best: ListGroup = "other";
  let bestLen = 0;
  for (const [prefix, group] of PREFIX_GROUPS) {
    if (s.startsWith(prefix) && prefix.length > bestLen) {
      best = group;
      bestLen = prefix.length;
    }
  }
  return best;
}

function isListGroup(value: string): value is ListGroup {
  return (LIST_GROUPS as readonly string[]).includes(value);
}

/** A product's own group when it sets one, otherwise the prefix rule. */
export function groupForProduct(sku: string, override: string | null | undefined): ListGroup {
  const o = (override ?? "").trim();
  return o && isListGroup(o) ? o : groupForSku(sku);
}

export const GROUP_LABELS: Record<ListGroup, string> = {
  harvest: "Harvest list",
  meat: "Meat allocation",
  eggs: "Egg packing",
  veldwonder: "VeldWonder order",
  milkwood: "Milkwood order",
  box: "Veg boxes",
  shipping: "Delivery",
  other: "Other",
};
