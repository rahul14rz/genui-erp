import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const ROLES = ["owner", "sales_rep", "warehouse", "accounts"] as const;
export type Role = (typeof ROLES)[number];

export const roleEnum = pgEnum("user_role", ROLES);
export const orderStatus = pgEnum("order_status", [
  "confirmed",
  "picking",
  "packed",
  "dispatched",
  "delivered",
  "cancelled",
]);
export const dispatchStatus = pgEnum("dispatch_status", [
  "queued",
  "picking",
  "packed",
  "dispatched",
  "delivered",
]);
export const poStatus = pgEnum("po_status", ["open", "partial", "received", "cancelled"]);
export const invoiceStatus = pgEnum("invoice_status", ["open", "partial", "paid", "void"]);
export const ledgerKind = pgEnum("ledger_kind", ["invoice", "payment", "credit_note", "adjustment"]);
export const approvalKind = pgEnum("approval_kind", ["discount", "credit_override", "price_change"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const quoteStatus = pgEnum("quote_status", ["draft", "sent", "accepted", "expired"]);
export const auditOutcome = pgEnum("audit_outcome", ["ok", "denied", "invalid", "error"]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);
const cents = (name: string) => bigint(name, { mode: "number" });
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const tenants = pgTable("tenants", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    passwordHash: text("password_hash").notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    creditLimitCents: cents("credit_limit_cents").notNull(),
    notes: text("notes"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("customers_code_idx").on(t.tenantId, t.code),
    index("customers_owner_idx").on(t.ownerUserId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    tenantId: tenantId(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    priceCents: cents("price_cents").notNull(),
    costCents: cents("cost_cents").notNull(),
  },
  (t) => [uniqueIndex("products_sku_idx").on(t.tenantId, t.sku)],
);

export const warehouses = pgTable("warehouses", {
  id: id(),
  tenantId: tenantId(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  city: text("city").notNull(),
});

export const stockLevels = pgTable(
  "stock_levels",
  {
    tenantId: tenantId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    onHand: integer("on_hand").notNull(),
    reserved: integer("reserved").notNull(),
    reorderPoint: integer("reorder_point").notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.warehouseId] })],
);

export const stockAdjustments = pgTable("stock_adjustments", {
  id: id(),
  tenantId: tenantId(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  at: at("at").notNull().defaultNow(),
});

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: id(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    status: orderStatus("status").notNull(),
    orderedAt: at("ordered_at").notNull(),
    requiredBy: date("required_by", { mode: "string" }).notNull(),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("sales_orders_number_idx").on(t.tenantId, t.number),
    index("sales_orders_customer_idx").on(t.customerId),
    index("sales_orders_ordered_idx").on(t.tenantId, t.orderedAt),
  ],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    qty: integer("qty").notNull(),
    unitPriceCents: cents("unit_price_cents").notNull(),
    unitCostCents: cents("unit_cost_cents").notNull(),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [index("sales_order_lines_order_idx").on(t.orderId)],
);

export const quotes = pgTable("quotes", {
  id: id(),
  tenantId: tenantId(),
  number: text("number").notNull(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  status: quoteStatus("status").notNull(),
  lines: jsonb("lines").notNull(),
  createdAt: at("created_at").notNull().defaultNow(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: id(),
  tenantId: tenantId(),
  number: text("number").notNull(),
  supplierName: text("supplier_name").notNull(),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  status: poStatus("status").notNull(),
  orderedAt: at("ordered_at").notNull(),
  expectedAt: date("expected_at", { mode: "string" }).notNull(),
});

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: id(),
  tenantId: tenantId(),
  purchaseOrderId: uuid("purchase_order_id")
    .notNull()
    .references(() => purchaseOrders.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  qty: integer("qty").notNull(),
  receivedQty: integer("received_qty").notNull(),
  unitCostCents: cents("unit_cost_cents").notNull(),
});

export const dispatches = pgTable(
  "dispatches",
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    status: dispatchStatus("status").notNull(),
    queuedAt: at("queued_at").notNull(),
    dispatchedAt: at("dispatched_at"),
    carrier: text("carrier"),
  },
  (t) => [uniqueIndex("dispatches_order_idx").on(t.orderId)],
);

export const dispatchEvents = pgTable(
  "dispatch_events",
  {
    id: id(),
    tenantId: tenantId(),
    dispatchId: uuid("dispatch_id")
      .notNull()
      .references(() => dispatches.id),
    status: dispatchStatus("status").notNull(),
    at: at("at").notNull(),
    note: text("note"),
  },
  (t) => [index("dispatch_events_dispatch_idx").on(t.dispatchId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    orderId: uuid("order_id").references(() => salesOrders.id),
    issuedAt: at("issued_at").notNull(),
    dueAt: date("due_at", { mode: "string" }).notNull(),
    totalCents: cents("total_cents").notNull(),
    paidCents: cents("paid_cents").notNull(),
    status: invoiceStatus("status").notNull(),
  },
  (t) => [index("invoices_customer_idx").on(t.customerId)],
);

export const payments = pgTable("payments", {
  id: id(),
  tenantId: tenantId(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  amountCents: cents("amount_cents").notNull(),
  receivedAt: at("received_at").notNull(),
  method: text("method").notNull(),
  reference: text("reference").notNull(),
});

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    at: at("at").notNull(),
    kind: ledgerKind("kind").notNull(),
    reference: text("reference").notNull(),
    debitCents: cents("debit_cents").notNull(),
    creditCents: cents("credit_cents").notNull(),
  },
  (t) => [index("ledger_entries_customer_idx").on(t.customerId, t.at)],
);

export const approvalRequests = pgTable("approval_requests", {
  id: id(),
  tenantId: tenantId(),
  kind: approvalKind("kind").notNull(),
  status: approvalStatus("status").notNull(),
  requestedBy: uuid("requested_by")
    .notNull()
    .references(() => users.id),
  customerId: uuid("customer_id").references(() => customers.id),
  orderId: uuid("order_id").references(() => salesOrders.id),
  payload: jsonb("payload").notNull(),
  reason: text("reason").notNull(),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: at("decided_at"),
  decisionReason: text("decision_reason"),
  createdAt: at("created_at").notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: roleEnum("role").notNull(),
    action: text("action").notNull(),
    outcome: auditOutcome("outcome").notNull(),
    idempotencyKey: text("idempotency_key"),
    input: jsonb("input").notNull(),
    result: jsonb("result"),
    at: at("at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("audit_log_idempotency_idx")
      .on(t.tenantId, t.userId, t.action, t.idempotencyKey)
      .where(sql`outcome = 'ok'`),
  ],
);
