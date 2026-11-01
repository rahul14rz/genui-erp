import { ROLES, type Role } from "@genui-erp/db";
import { generate } from "@genui-erp/db/seed";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIONS } from "../src/actions/execute.ts";
import { ROLE_PERMISSIONS } from "../src/generated/permissions.ts";
import { ADMIN_URL, ANCHOR, startHarness, type Harness } from "./harness.ts";

const data = generate(ANCHOR);
const north = data.tenants.find((t) => t.slug === "northfield")!;
const coast = data.tenants.find((t) => t.slug === "coastline")!;
const inTenant = <T extends { tenantId: string }>(rows: T[], t = north) => rows.filter((r) => r.tenantId === t.id);
const rep = data.users.find((u) => u.tenantId === north.id && u.role === "sales_rep")!;

const queued = inTenant(data.dispatches).filter((d) => ["queued", "picking", "packed"].includes(d.status));
const orderOf = (id: string) => data.salesOrders.find((o) => o.id === id)!;
const stock = inTenant(data.stockLevels).find((s) => s.onHand > 50)!;
const skuOf = (productId: string) => data.products.find((p) => p.id === productId)!.sku;
const whOf = (id: string) => data.warehouses.find((w) => w.id === id)!.code;
const repOpenOrder = inTenant(data.salesOrders).find(
  (o) => ["confirmed", "picking", "packed"].includes(o.status) && data.customers.find((c) => c.id === o.customerId)!.ownerUserId === rep.id,
)!;
const repCustomer = inTenant(data.customers).find((c) => c.ownerUserId === rep.id)!;
const pending = (kind: string, t = north) => inTenant(data.approvalRequests, t).filter((a) => a.kind === kind && a.status === "pending");
const openInvoices = inTenant(data.invoices).filter((i) => i.status === "open");
const product = inTenant(data.products)[0]!;

// One allowed role and a valid input for each action, against Northfield.
const CASES: Record<string, { role: Role; input: () => object; crossTenant: () => object }> = {
  markDispatched: {
    role: "warehouse",
    input: () => ({ orderNumber: orderOf(queued[0]!.orderId).number, carrier: "Pennine Couriers" }),
    crossTenant: () => ({
      orderNumber: orderOf(inTenant(data.dispatches, coast).find((d) => d.status === "packed" || d.status === "picking")!.orderId).number,
      carrier: "X Freight",
    }),
  },
  adjustStock: {
    role: "warehouse",
    input: () => ({ sku: skuOf(stock.productId), warehouseCode: whOf(stock.warehouseId), delta: -3, reason: "Damaged in handling" }),
    crossTenant: () => {
      const s = inTenant(data.stockLevels, coast)[0]!;
      return { sku: skuOf(s.productId), warehouseCode: whOf(s.warehouseId), delta: 1, reason: "count" };
    },
  },
  requestDiscount: {
    role: "sales_rep",
    input: () => ({ orderNumber: repOpenOrder.number, discountPct: 8, reason: "Competing quote" }),
    crossTenant: () => ({ orderNumber: inTenant(data.salesOrders, coast).at(-1)!.number, discountPct: 8, reason: "x x x" }),
  },
  createQuote: {
    role: "sales_rep",
    input: () => ({ customerCode: repCustomer.code, lines: [{ sku: product.sku, qty: 12 }] }),
    crossTenant: () => ({ customerCode: inTenant(data.customers, coast)[0]!.code, lines: [{ sku: product.sku, qty: 1 }] }),
  },
  decideApproval: {
    role: "owner",
    input: () => ({ requestId: pending("discount")[0]!.id, decision: "approve", reason: "Fine for this season" }),
    crossTenant: () => ({ requestId: pending("discount", coast)[0]!.id, decision: "approve", reason: "x x x" }),
  },
  adjustPrice: {
    role: "owner",
    input: () => ({ sku: product.sku, priceCents: product.priceCents + 100, reason: "Supplier increase" }),
    crossTenant: () => ({ sku: "ZZ-00-NONE", priceCents: 100, reason: "x x x" }),
  },
  recordPayment: {
    role: "accounts",
    input: () => ({ invoiceNumber: openInvoices[0]!.number, amountCents: 1000, method: "bank_transfer", reference: "BT-1001" }),
    crossTenant: () => ({
      invoiceNumber: inTenant(data.invoices, coast).find((i) => i.status === "open")!.number,
      amountCents: 1,
      method: "card",
      reference: "XX",
    }),
  },
};

let h: Harness;
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
  await admin.end();
});

const auditRows = async (action: string, key: string | null, outcome?: string) =>
  (
    await admin.query(
      "select outcome, role from audit_log where action = $1 and ($2::text is null or idempotency_key = $2) and ($3::text is null or outcome::text = $3)",
      [action, key, outcome ?? null],
    )
  ).rows;

describe("every action declares a case", () => {
  it("covers each registered action", () => {
    expect(Object.keys(CASES).sort()).toEqual(ACTIONS.map((a) => a.name).sort());
  });
});

describe.each(ACTIONS.map((a) => a.name))("%s", (name) => {
  const c = CASES[name]!;
  const action = ACTIONS.find((a) => a.name === name)!;
  const allowed = ROLES.filter((r) => (ROLE_PERMISSIONS[r] as readonly string[]).includes(action.permission));
  const denied = ROLES.filter((r) => !allowed.includes(r));

  it("is allowed for the expected role", () => {
    expect(allowed).toContain(c.role);
  });

  it("previews without writing", async () => {
    const token = await h.login("northfield", c.role);
    const before = (await admin.query("select count(*)::int as n from audit_log where outcome = 'ok'")).rows[0].n;
    const res = await h.call(token, "POST", `/api/actions/${name}/preview`, c.input());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.preview.changes.length).toBeGreaterThan(0);
    expect((await admin.query("select count(*)::int as n from audit_log where outcome = 'ok'")).rows[0].n).toBe(before);
  });

  it("requires an idempotency key", async () => {
    const token = await h.login("northfield", c.role);
    const res = await h.call(token, "POST", `/api/actions/${name}`, c.input());
    expect(res.status).toBe(400);
  });

  it("rejects invalid input and audits it", async () => {
    const token = await h.login("northfield", c.role);
    const key = randomUUID();
    const res = await h.call(token, "POST", `/api/actions/${name}`, { nonsense: true }, { "idempotency-key": key });
    expect(res.status).toBe(400);
    expect(await auditRows(name, key, "invalid")).toHaveLength(1);
  });

  it.each(denied)("refuses %s and writes a denied audit row", async (role) => {
    const token = await h.login("northfield", role);
    const key = randomUUID();
    const res = await h.call(token, "POST", `/api/actions/${name}`, c.input(), { "idempotency-key": key });
    expect(res.status).toBe(403);
    expect(await auditRows(name, key, "denied")).toEqual([{ outcome: "denied", role }]);
  });

  it("cannot reach a row in another tenant", async () => {
    const token = await h.login("northfield", c.role);
    const res = await h.call(token, "POST", `/api/actions/${name}`, c.crossTenant(), { "idempotency-key": randomUUID() });
    expect(res.status).toBe(404);
  });

  it("runs once per idempotency key and audits the write", async () => {
    const token = await h.login("northfield", c.role);
    const key = randomUUID();
    const input = c.input();
    const first = await h.call(token, "POST", `/api/actions/${name}`, input, { "idempotency-key": key });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.replayed).toBe(false);
    const again = await h.call(token, "POST", `/api/actions/${name}`, input, { "idempotency-key": key });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.result).toEqual(first.body.result);
    expect(await auditRows(name, key, "ok")).toEqual([{ outcome: "ok", role: c.role }]);
    const field = Object.keys(input).filter((k) => typeof (input as Record<string, unknown>)[k] === "string" && k !== "requestId").at(-1)!;
    const changed = { ...input, [field]: `${(input as Record<string, string>)[field]} changed` };
    const conflict = await h.call(token, "POST", `/api/actions/${name}`, changed, { "idempotency-key": key });
    expect(conflict.status).toBe(409);
  });
});

describe("action effects", () => {
  it("marks the dispatch and the order dispatched with one event", async () => {
    const d = queued[1]!;
    const token = await h.login("northfield", "warehouse");
    const res = await h.call(
      token,
      "POST",
      "/api/actions/markDispatched",
      { orderNumber: orderOf(d.orderId).number, carrier: "Royal Parcel" },
      { "idempotency-key": randomUUID() },
    );
    expect(res.status).toBe(200);
    const { rows } = await admin.query(
      "select d.status, d.carrier, o.status as order_status, (select count(*)::int from dispatch_events e where e.dispatch_id = d.id and e.status = 'dispatched') as events from dispatches d join sales_orders o on o.id = d.order_id where d.id = $1",
      [d.id],
    );
    expect(rows[0]).toEqual({ status: "dispatched", carrier: "Royal Parcel", order_status: "dispatched", events: 1 });
  });

  it("refuses to take stock below zero", async () => {
    const token = await h.login("northfield", "warehouse");
    const res = await h.call(
      token,
      "POST",
      "/api/actions/adjustStock",
      { sku: skuOf(stock.productId), warehouseCode: whOf(stock.warehouseId), delta: -9999, reason: "count" },
      { "idempotency-key": randomUUID() },
    );
    expect(res.status).toBe(400);
  });

  it("refuses a payment larger than the outstanding amount", async () => {
    const inv = openInvoices[1]!;
    const token = await h.login("northfield", "accounts");
    const res = await h.call(
      token,
      "POST",
      "/api/actions/recordPayment",
      { invoiceNumber: inv.number, amountCents: inv.totalCents + 1, method: "card", reference: "CARD-1" },
      { "idempotency-key": randomUUID() },
    );
    expect(res.status).toBe(400);
  });

  it("lets accounts approve a credit override and raises the limit", async () => {
    const req = pending("credit_override")[0]!;
    const token = await h.login("northfield", "accounts");
    const res = await h.call(
      token,
      "POST",
      "/api/actions/decideApproval",
      { requestId: req.id, decision: "approve", reason: "Payment history is good" },
      { "idempotency-key": randomUUID() },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { rows } = await admin.query("select credit_limit_cents::int as l from customers where id = $1", [req.customerId]);
    expect(rows[0].l).toBe((req.payload as { requestedLimitCents: number }).requestedLimitCents);
  });

  it("does not let accounts decide a discount request", async () => {
    const token = await h.login("northfield", "accounts");
    const res = await h.call(
      token,
      "POST",
      "/api/actions/decideApproval",
      { requestId: pending("discount")[1]!.id, decision: "approve", reason: "Looks fine" },
      { "idempotency-key": randomUUID() },
    );
    expect(res.status).toBe(404);
  });

  it("returns one result when the same key is sent twice at once", async () => {
    const token = await h.login("northfield", "sales_rep");
    const key = randomUUID();
    const input = { customerCode: repCustomer.code, lines: [{ sku: product.sku, qty: 3 }] };
    const [a, b] = await Promise.all([
      h.call(token, "POST", "/api/actions/createQuote", input, { "idempotency-key": key }),
      h.call(token, "POST", "/api/actions/createQuote", input, { "idempotency-key": key }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.result).toEqual(b.body.result);
    expect(await auditRows("createQuote", key, "ok")).toHaveLength(1);
    const quotes = await admin.query("select count(*)::int as n from quotes where number = $1", [a.body.result.number]);
    expect(quotes.rows[0].n).toBe(1);
  });
});
