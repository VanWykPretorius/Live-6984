import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
export * from "./auth-schema";

export type TimeEntry = { projectId: number; project: string; minutes: number; description: string };
export type TimeEvent = { action: string; at: string; actor: string; note: string; entries?: TimeEntry[] };

export const farmEmployees = sqliteTable("farm_employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const farmProjects = sqliteTable("farm_projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const timesheetDays = sqliteTable("timesheet_days", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => farmEmployees.id),
  date: text("date").notNull(),
  status: text("status").notNull().default("draft"),
  entries: text("entries", { mode: "json" }).$type<TimeEntry[]>().notNull(),
  totalMinutes: integer("total_minutes").notNull(),
  revision: integer("revision").notNull().default(1),
  returnNote: text("return_note").notNull().default(""),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  updatedAt: text("updated_at").notNull(),
  audit: text("audit", { mode: "json" }).$type<TimeEvent[]>().notNull(),
}, (t) => [uniqueIndex("timesheet_employee_day_idx").on(t.employeeId, t.date)]);

export type BroilerAuditEvent = { action: string; at: string; actor: string; note?: string };

/** Brooder and pasture pens used to locate each batch. */
export const broilerPens = sqliteTable("broiler_pens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /** brooder | pasture */
  kind: text("kind").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Feed register. bagsOnHand is maintained transactionally from deliveries/withdrawals. */
export const broilerFeedTypes = sqliteTable("broiler_feed_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  bagWeightKg: real("bag_weight_kg").notNull().default(40),
  bagsOnHand: integer("bags_on_hand").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Xero item catalog — SKUs match the website SKUs. */
export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sku: text("sku").notNull().unique(),
  description: text("description").notNull(),
  unitPrice: real("unit_price"),
  accountCode: text("account_code"),
  taxType: text("tax_type"),
  /** Option within the Xero tracking category named in settings.trackingCategoryName. */
  trackingOption: text("tracking_option"),
  /** product | box | shipping | discount */
  kind: text("kind").notNull().default("product"),
  /**
   * Which weekly list this item belongs on: harvest | meat | eggs | veldwonder | milkwood |
   * box | shipping | other. Null means "work it out from the SKU prefix".
   */
  listGroup: text("list_group"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Raw website item names mapped to a catalog product (for exports without SKUs). */
export const productAliases = sqliteTable("product_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  aliasText: text("alias_text").notNull().unique(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** A planned chick arrival becomes a live batch only after the manager confirms receipt. */
export const broilerBatches = sqliteTable("broiler_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  plannedDate: text("planned_date").notNull(),
  plannedCount: integer("planned_count").notNull(),
  actualDate: text("actual_date"),
  receivedCount: integer("received_count"),
  deadOnArrival: integer("dead_on_arrival").notNull().default(0),
  arrivalPenId: integer("arrival_pen_id").references(() => broilerPens.id),
  supplier: text("supplier").notNull().default(""),
  /** Total chick cost, when known. */
  chickCost: real("chick_cost"),
  /** planned | active | closed */
  status: text("status").notNull().default("planned"),
  liveBirds: integer("live_birds").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: text("updated_at").notNull(),
  audit: text("audit", { mode: "json" }).$type<BroilerAuditEvent[]>().notNull(),
});

/** Current birds per batch and pen; movements are applied transactionally. */
export const broilerPenStocks = sqliteTable(
  "broiler_pen_stocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => broilerBatches.id, { onDelete: "cascade" }),
    penId: integer("pen_id")
      .notNull()
      .references(() => broilerPens.id),
    birdCount: integer("bird_count").notNull().default(0),
  },
  (t) => [uniqueIndex("broiler_batch_pen_idx").on(t.batchId, t.penId)],
);

/** Immutable batch event header. Corrections void an event and keep the audit trail. */
export const broilerEvents = sqliteTable("broiler_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: integer("batch_id")
    .notNull()
    .references(() => broilerBatches.id, { onDelete: "cascade" }),
  /** arrival | death | move | slaughter */
  type: text("type").notNull(),
  eventDate: text("event_date").notNull(),
  totalCount: integer("total_count").notNull(),
  employeeId: integer("employee_id").references(() => farmEmployees.id),
  actor: text("actor").notNull(),
  note: text("note").notNull().default(""),
  reason: text("reason").notNull().default(""),
  expectedCount: integer("expected_count"),
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Pen-level counts behind each batch event. */
export const broilerEventAllocations = sqliteTable("broiler_event_allocations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => broilerEvents.id, { onDelete: "cascade" }),
  penId: integer("pen_id")
    .notNull()
    .references(() => broilerPens.id),
  /** arrival | remove | source | destination */
  role: text("role").notNull(),
  birdCount: integer("bird_count").notNull(),
});

export const broilerSlaughters = sqliteTable("broiler_slaughters", {
  eventId: integer("event_id")
    .primaryKey()
    .references(() => broilerEvents.id, { onDelete: "cascade" }),
  totalDressedWeightKg: real("total_dressed_weight_kg").notNull(),
  totalProductWeightKg: real("total_product_weight_kg").notNull(),
});

export const broilerSlaughterOutputs = sqliteTable("broiler_slaughter_outputs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => broilerEvents.id, { onDelete: "cascade" }),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  weightKg: real("weight_kg").notNull(),
});

/** Chicken products tracked as kg stock, with the invoice-quantity-to-kg conversion. */
export const broilerStockProducts = sqliteTable("broiler_stock_products", {
  productId: integer("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  kgPerUnit: real("kg_per_unit").notNull().default(1),
  kgOnHand: real("kg_on_hand").notNull().default(0),
  /** kg = weighed loose stock; bags = counted in fixed-weight bags (bag weight = kgPerUnit). */
  unit: text("unit").notNull().default("kg"),
  revision: integer("revision").notNull().default(1),
});

/** Signed stock ledger; referenceKey makes slaughter/report application idempotent. */
export const broilerStockMovements = sqliteTable("broiler_stock_movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  /** slaughter | slaughter_reversal | sale | sale_reversal | adjustment */
  kind: text("kind").notNull(),
  quantityKg: real("quantity_kg").notNull(),
  referenceKey: text("reference_key").notNull().unique(),
  referenceId: integer("reference_id"),
  employeeId: integer("employee_id").references(() => farmEmployees.id),
  actor: text("actor").notNull(),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Bags delivered into storage or taken out. Corrections void the original movement. */
export const broilerFeedMovements = sqliteTable("broiler_feed_movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feedTypeId: integer("feed_type_id")
    .notNull()
    .references(() => broilerFeedTypes.id),
  /** delivery | withdrawal */
  kind: text("kind").notNull(),
  movementDate: text("movement_date").notNull(),
  bags: integer("bags").notNull(),
  batchId: integer("batch_id").references(() => broilerBatches.id),
  penId: integer("pen_id").references(() => broilerPens.id),
  employeeId: integer("employee_id").references(() => farmEmployees.id),
  actor: text("actor").notNull(),
  note: text("note").notNull().default(""),
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Singleton register for the 19 kg gas bottles that heat the brooders. */
export const broilerGas = sqliteTable("broiler_gas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bottleSizeKg: real("bottle_size_kg").notNull().default(19),
  bottlesOnHand: integer("bottles_on_hand").notNull().default(4),
  /** Par level — the farm wants this many full bottles in storage. */
  targetBottles: integer("target_bottles").notNull().default(4),
  revision: integer("revision").notNull().default(1),
});

/** Bottles delivered into storage or taken out to the brooders. */
export const broilerGasMovements = sqliteTable("broiler_gas_movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** delivery | withdrawal */
  kind: text("kind").notNull(),
  movementDate: text("movement_date").notNull(),
  bottles: integer("bottles").notNull(),
  batchId: integer("batch_id").references(() => broilerBatches.id),
  penId: integer("pen_id").references(() => broilerPens.id),
  employeeId: integer("employee_id").references(() => farmEmployees.id),
  actor: text("actor").notNull(),
  note: text("note").notNull().default(""),
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Egg mobiles (mobile layer coops) that hens roost in and eggs are collected from. */
export const eggMobiles = sqliteTable("egg_mobiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /** Live hens currently in this mobile; maintained transactionally from bird events. */
  birdCount: integer("bird_count").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** One row per mobile per day: eggs laid = saleable + broken (enforced). */
export const eggCollections = sqliteTable("egg_collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mobileId: integer("mobile_id")
    .notNull()
    .references(() => eggMobiles.id),
  collectionDate: text("collection_date").notNull(),
  laid: integer("laid").notNull(),
  saleable: integer("saleable").notNull(),
  broken: integer("broken").notNull(),
  employeeId: integer("employee_id").references(() => farmEmployees.id),
  actor: text("actor").notNull(),
  note: text("note").notNull().default(""),
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Layer flock ledger: arrivals, deaths and moves between mobiles. Corrections void the event. */
export const layerBirdEvents = sqliteTable("layer_bird_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mobileId: integer("mobile_id")
    .notNull()
    .references(() => eggMobiles.id),
  /** arrival | death | move */
  kind: text("kind").notNull(),
  /** Destination mobile for moves; null otherwise. */
  toMobileId: integer("to_mobile_id").references(() => eggMobiles.id),
  eventDate: text("event_date").notNull(),
  count: integer("count").notNull(),
  employeeId: integer("employee_id").references(() => farmEmployees.id),
  actor: text("actor").notNull(),
  note: text("note").notNull().default(""),
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Layer feed register — a single feed type; bagsOnHand maintained transactionally. */
export const layerFeedTypes = sqliteTable("layer_feed_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  bagWeightKg: real("bag_weight_kg").notNull().default(40),
  bagsOnHand: integer("bags_on_hand").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Layer feed bags delivered into storage or taken out to a mobile. Corrections void the movement. */
export const layerFeedMovements = sqliteTable("layer_feed_movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feedTypeId: integer("feed_type_id")
    .notNull()
    .references(() => layerFeedTypes.id),
  /** delivery | withdrawal */
  kind: text("kind").notNull(),
  movementDate: text("movement_date").notNull(),
  bags: integer("bags").notNull(),
  mobileId: integer("mobile_id").references(() => eggMobiles.id),
  employeeId: integer("employee_id").references(() => farmEmployees.id),
  actor: text("actor").notNull(),
  note: text("note").notNull().default(""),
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Singleton register of loose saleable eggs on hand, fed by collections and drained by invoices. */
export const eggStock = sqliteTable("egg_stock", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eggsOnHand: integer("eggs_on_hand").notNull().default(0),
  revision: integer("revision").notNull().default(1),
});

/** EGG% catalog products tracked against the loose-egg pool, with the pack-size conversion. */
export const eggStockProducts = sqliteTable("egg_stock_products", {
  productId: integer("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** Eggs in one invoiced unit, e.g. 30 for "30 x Pastured Eggs". */
  eggsPerUnit: integer("eggs_per_unit").notNull().default(1),
});

/** Signed loose-egg ledger; referenceKey makes collections/report application idempotent. */
export const eggStockMovements = sqliteTable("egg_stock_movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** collection | collection_reversal | sale | sale_reversal | adjustment */
  kind: text("kind").notNull(),
  quantityEggs: integer("quantity_eggs").notNull(),
  referenceKey: text("reference_key").notNull().unique(),
  referenceId: integer("reference_id"),
  employeeId: integer("employee_id").references(() => farmEmployees.id),
  actor: text("actor").notNull(),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  region: text("region"),
  postalCode: text("postal_code"),
  country: text("country"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderNumber: text("order_number").notNull().unique(),
  /** website | api | manual */
  source: text("source").notNull().default("website"),
  customerId: integer("customer_id").references(() => customers.id),
  orderDate: text("order_date").notNull(),
  websiteStatus: text("website_status"),
  shippingMethod: text("shipping_method"),
  customerNote: text("customer_note"),
  discountTotal: real("discount_total").notNull().default(0),
  shippingTotal: real("shipping_total").notNull().default(0),
  taxTotal: real("tax_total").notNull().default(0),
  orderTotal: real("order_total").notNull().default(0),
  /** pending | invoiced | ignored */
  invoiceStatus: text("invoice_status").notNull().default("pending"),
  invoiceNumber: text("invoice_number"),
  batchId: integer("batch_id"),
  rawItems: text("raw_items"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const orderLines = sqliteTable("order_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  rawText: text("raw_text").notNull(),
  rawName: text("raw_name").notNull(),
  sku: text("sku"),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitPrice: real("unit_price"),
  productId: integer("product_id").references(() => products.id),
  /** matched | unmatched | ignored */
  status: text("status").notNull().default("unmatched"),
});

export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  boxProductId: integer("box_product_id").references(() => products.id),
  boxPrice: real("box_price").notNull().default(200),
  boxQuantity: real("box_quantity").notNull().default(1),
  /** weekly | biweekly */
  frequency: text("frequency").notNull().default("weekly"),
  startDate: text("start_date").notNull(),
  /** active | paused | cancelled */
  status: text("status").notNull().default("active"),
  pauseFrom: text("pause_from"),
  pauseTo: text("pause_to"),
  includeShipping: integer("include_shipping", { mode: "boolean" }).notNull().default(false),
  shippingAmount: real("shipping_amount").notNull().default(0),
  reference: text("reference"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const subscriptionAddons = sqliteTable("subscription_addons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subscriptionId: integer("subscription_id")
    .notNull()
    .references(() => subscriptions.id, { onDelete: "cascade" }),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  quantity: real("quantity").notNull().default(1),
  /** null = use the catalog price */
  unitPrice: real("unit_price"),
});

/** One row per subscription delivery that has been invoiced — prevents double billing. */
export const deliveries = sqliteTable(
  "deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    deliveryDate: text("delivery_date").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    total: real("total").notNull().default(0),
    batchId: integer("batch_id"),
    /** invoiced | skipped */
    status: text("status").notNull().default("invoiced"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("deliveries_sub_date_idx").on(t.subscriptionId, t.deliveryDate)],
);

export const invoiceBatches = sqliteTable("invoice_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** orders | subscriptions | combined */
  type: text("type").notNull(),
  label: text("label").notNull(),
  fromDate: text("from_date"),
  toDate: text("to_date"),
  invoiceCount: integer("invoice_count").notNull().default(0),
  lineCount: integer("line_count").notNull().default(0),
  total: real("total").notNull().default(0),
  fileName: text("file_name").notNull(),
  csv: text("csv").notNull(),
  /** active | voided */
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Persistent number reservation survives batch voiding/deletion. */
export const invoiceSequences = sqliteTable("invoice_sequences", {
  prefix: text("prefix").primaryKey(),
  nextNumber: integer("next_number").notNull(),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dueDays: integer("due_days").notNull().default(7),
  /** dd/MM/yyyy | yyyy-MM-dd | MM/dd/yyyy */
  dateFormat: text("date_format").notNull().default("dd/MM/yyyy"),
  defaultAccountCode: text("default_account_code").notNull().default("200"),
  defaultTaxType: text("default_tax_type").notNull().default("Tax Exempt"),
  /** Xero tracking category these options belong to; blank disables the tracking columns. */
  trackingCategoryName: text("tracking_category_name").notNull().default(""),
  defaultTrackingOption: text("default_tracking_option").notNull().default(""),
  currency: text("currency").notNull().default("ZAR"),
  brandingTheme: text("branding_theme"),
  orderInvoicePrefix: text("order_invoice_prefix").notNull().default("WEB-"),
  subscriptionInvoicePrefix: text("subscription_invoice_prefix").notNull().default("BOX-"),
  shippingSku: text("shipping_sku").notNull().default("SHIP"),
  shippingDescription: text("shipping_description").notNull().default("Delivery"),
  shippingAccountCode: text("shipping_account_code").notNull().default("200"),
  shippingTaxType: text("shipping_tax_type").notNull().default("Tax Exempt"),
  shippingTrackingOption: text("shipping_tracking_option").notNull().default(""),
  discountSku: text("discount_sku").notNull().default("DISC"),
  discountDescription: text("discount_description").notNull().default("Discount"),
  discountTrackingOption: text("discount_tracking_option").notNull().default(""),
  defaultBoxSku: text("default_box_sku").notNull().default(""),
  defaultBoxPrice: real("default_box_price").notNull().default(200),
  defaultShippingAmount: real("default_shipping_amount").notNull().default(50),
  apiKey: text("api_key").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * One imported Xero "Inventory Item Details" report, covering a single delivery week.
 * The report is the source of truth for what was actually sold, so every weekly list
 * (harvest, meat, eggs, supplier orders) is derived from one of these runs.
 */
export const packRuns = sqliteTable(
  "pack_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    label: text("label").notNull(),
    /** Report period as printed in the file, when it could be read. */
    periodFrom: text("period_from"),
    periodTo: text("period_to"),
    fileName: text("file_name").notNull().default(""),
    /** Total veg boxes sold in the period, summed across every box SKU. */
    boxCount: real("box_count").notNull().default(0),
    /** Canonical report fingerprint blocks importing the same report twice. */
    reportFingerprint: text("report_fingerprint"),
    /** Set after a manager applies this sales report to chicken stock. */
    stockAppliedAt: text("stock_applied_at"),
    stockAppliedBy: text("stock_applied_by"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("pack_run_report_fingerprint_idx").on(t.reportFingerprint)],
);

/** One invoice line from the imported report. Quantities are stored positive. */
export const packRunLines = sqliteTable("pack_run_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id")
    .notNull()
    .references(() => packRuns.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  /** Item name from the report's group header, e.g. "Beef Brisket (kg)". */
  itemName: text("item_name").notNull(),
  /** Line description as invoiced, which can differ from the item name. */
  description: text("description").notNull().default(""),
  reference: text("reference").notNull().default(""),
  contact: text("contact").notNull().default(""),
  quantity: real("quantity").notNull().default(0),
  value: real("value").notNull().default(0),
  listGroup: text("list_group").notNull().default("other"),
});

/**
 * The veg chosen for a box in one particular week, as a quantity per box.
 * Kept per run so past weeks' box contents stay on record.
 */
export const boxRecipeItems = sqliteTable(
  "box_recipe_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => packRuns.id, { onDelete: "cascade" }),
    /** Which box this line belongs to, e.g. VEGBOX — supports more box types later. */
    boxSku: text("box_sku").notNull(),
    sku: text("sku").notNull(),
    description: text("description").notNull().default(""),
    qtyPerBox: real("qty_per_box").notNull().default(1),
  },
  (t) => [uniqueIndex("box_recipe_run_box_sku_idx").on(t.runId, t.boxSku, t.sku)],
);
