# FarmBox Invoicing — Design

Internal web tool (single operator) that turns WooCommerce order exports and vegetable-box
subscriptions into Xero bulk-invoice CSV files. Dense, utilitarian, farm-warm: think a clean
packing-shed clipboard rather than a SaaS marketing page. Web only.

## Brand & Colors

CSS variables in `packages/web/src/web/styles.css` (light only — internal tool, no dark mode toggle).

| Token | Value | Use |
|-------|-------|-----|
| background | #F6F3EA (cream) | Page background |
| card | #FFFFFF | Surfaces, tables |
| primary | #1C4025 (forest) | Nav rail, primary buttons, headings |
| accent | #C1662F (terracotta) | Actions needing attention, active nav item |
| leaf | #4A7C43 | Success / active subscription |
| foreground | #17231A | Primary text |
| mutedForeground | #6B7268 | Secondary text, labels |
| border | #E2DCCC | Hairlines |
| destructive | #B3261E | Destructive / errors |
| warning | #B98900 | Needs-attention chips (missing price, unmatched SKU) |

## Typography

- Display: **Fraunces** (600/700) — page titles, numbers in stat cards.
- Body/UI: **Plus Jakarta Sans** (400/500/600) — everything else.
- Tabular numerals (`font-variant-numeric: tabular-nums`) for all money and quantity cells.
- Loaded via Google Fonts `<link>` in `packages/web/index.html`.

## Layout

- Fixed left nav rail (forest, 240px) with app mark + sections; content area max-w-[1400px], p-8.
- Data tables are the primary UI: 13px rows, sticky headers, hairline borders, zebra on hover.
- Status shown as small pill chips. Money always right-aligned with `R` prefix.
- Radius 6px, shadows minimal (single soft shadow on cards/dialogs only).

## Pages

- **Dashboard** (`pages/index.tsx`) — pending orders, unmatched lines, items missing prices, active/paused subs, deliveries due this week, last batch, quick links.
- **Orders** (`pages/orders.tsx`) — upload WooCommerce CSV, order list + expandable line items, resolve unmatched lines to catalog SKUs, select orders → generate Xero CSV batch.
- **Subscriptions** (`pages/subscriptions.tsx`) — subscription list (customer, box, frequency, add-ons, next delivery, status), editor dialog, pause/resume with date range, cancel.
- **Billing Run** (`pages/billing.tsx`) — pick delivery date range, preview due deliveries with lines and totals, deselect any, generate subscription invoice batch.
- **Products** (`pages/products.tsx`) — Xero item catalog (SKU, description, price, account code, tax type), inline edit, CSV import of Xero item export, alias list.
- **Batches** (`pages/batches.tsx`) — history of generated CSVs, re-download, void (returns orders/deliveries to pending).
- **Settings** (`pages/settings.tsx`) — Xero defaults (due days, date format, account code, tax type, currency, branding theme, invoice prefixes), shipping/discount items, API key + ingest endpoint docs.

## Key Flows

1. **Website orders → Xero**: upload export CSV → lines parsed from the `Items` column (`Name (SKU) xQty`) → SKU matched to catalog (alias/manual mapping when the export has no SKU) → select orders → download Xero bulk CSV → orders marked invoiced in a batch.
2. **Subscription billing**: subscriptions generate deliveries on a weekly / every-2-weeks cadence from their start date, skipping pause windows → Billing Run for a date range lists deliveries not yet invoiced → generate → one invoice per delivery (box + add-ons + optional shipping) → deliveries logged so they can never be double-billed.
3. **Catalog upkeep**: any SKU seen in an import that is not in the catalog is auto-created as a draft needing a price; invoices are blocked until prices exist.

## Architecture

## Combined Xero billing
- Billing Run becomes a two-stage shared export: select box deliveries in a date range and any pending website orders; review one merged invoice per customer before generating a single CSV.
- Match customer IDs and normalized nonblank emails, never names or blank emails. Prefer subscription contact details and display all matched records in preview. No customer database records are merged.
- One editable invoice date defaults to Thursday of the selected week; all due dates use Settings payment terms. Combined invoices use reserved INV- numbering, distinct from legacy exports. Source order numbers and delivery dates stay on line descriptions/references.
- Preserve original line prices, SKU accounting/tax/tracking, each source's shipping and discount. Atomically store the batch and mark all sources invoiced; validate stale selections and preview changes. Voiding a combined batch restores both orders and deliveries.
- Reuse the existing forest/cream tables, terracotta actions and tabular money. Subscriptions and Website Orders link clearly to the combined export; existing order-only exports stay available.

## Pastured Broilers addition
- Two surfaces: manager page `/broilers` in the app shell (plan arrivals, confirm receipt, batch register, event history/voids, feed register, chicken stock, pen/feed setup, Weekly List stock application) and shared-device `/broilers/log` (phone-first; employee name selector, feed in/out, deaths, pasture moves, slaughter).
- `/broilers/log` bypasses the manager gate like `/timesheets/log`; it signs out any manager on entry and only then starts its public queries. Manager procedures use the same verified-manager bearer as the rest of the app.
- Planned batches never touch live balances; confirming arrival books live chicks into a brooder pen. Deaths, moves (with mandatory recount-adjustment reasons) and slaughter events are immutable ledger entries — corrections void an event (with reason) and reverse its pen/stock effects transactionally. Batch updates carry optimistic revisions.
- Moves always start in a brooder pen; destinations are brooder pens (shuffles between brooders) or pasture pens (move-out at ~3 weeks), never mixed in one entry and never the source pen.
- Feed types (40 kg bags seeded) track bags-on-hand; withdrawals can optionally tag a batch/pen and can never exceed storage. Manager voids reverse movements.
- A singleton gas register tracks 19 kg bottles for the brooder heaters (bottles on hand, target par level, bottle size). Employees log deliveries/withdrawals on the phone; withdrawals can optionally tag a batch/brooder and can never exceed storage. The manager edits bottle size/target and voids movements (delivery voids blocked while those bottles are already used). The phone log and manager stats warn when on-hand drops below target. Register and settings carry optimistic revisions.
- Slaughter records dressed weight and per-product kg, adding to chicken stock products (auto-seeded from active CHICK% catalog SKUs; kg-per-unit inferred from pack size, editable).
- Weekly List imports carry a content fingerprint (unique index; exact duplicate imports blocked). Applying a run deducts invoice quantities × kg-per-unit once, transactionally, with shortage checks; reversing or deleting the run restores exactly the outstanding sales rows (re-apply after reversal works; double-apply and double-reverse blocked).

## Timesheets addition
- Access policy: signed-out visitors see only Weekly Lists and the employee timesheet guide, with a separate manager sign-in link. Root opens Weekly Lists when signed out. Private screens never mount before verified manager access; all invoicing APIs require the same verified manager bearer. Clear query caches on hand-off/sign-out; retain API-key ingestion.
- Shared-device employee route `/timesheets/log` has no invoicing sidebar: centered, phone-first guide, 44px touch controls, one clear step at a time.
- Retain forest/cream/terracotta, Fraunces and Plus Jakarta Sans. Show friendly project labels alongside the exact Xero tracking option.
- Manager route `/timesheets` uses the existing app shell; review queue, weekly totals and employee/project setup. Only verified designated manager can call manager APIs.
- Submitted/approved days are read-only; returned days show the manager note prominently. Names on the shared device are a convenience selector, not employee authentication.

- oRPC procedures in `packages/web/src/api/routes/` (`products`, `orders`, `subscriptions`, `billing`, `settings`), shared helpers in `src/api/lib/` (`csv.ts`, `woo.ts`, `xero.ts`, `schedule.ts`).
- Plain HTTP `POST /api/ingest/orders` (x-api-key) for future automatic website sync.
- Drizzle/Turso SQLite tables: products, product_aliases, customers, orders, order_lines, subscriptions, subscription_addons, deliveries, invoice_batches, settings.
- TanStack Query hooks in `src/web/queries/`.
