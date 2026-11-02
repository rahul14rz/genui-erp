import { generate } from "@genui-erp/db/seed";
import type { Scope, TenantId, UserId } from "@genui-erp/db";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionStore } from "../src/agent/session.ts";
import { signToken } from "../src/auth/jwt.ts";
import { loadConfig } from "../src/config.ts";
import { ADMIN_URL, ANCHOR, startHarness, type Harness } from "./harness.ts";

// Each case reproduces a finding from the security review of this branch.
const data = generate(ANCHOR);
const north = data.tenants.find((t) => t.slug === "northfield")!;
const inNorth = <T extends { tenantId: string }>(rows: T[]) => rows.filter((r) => r.tenantId === north.id);

let h: Harness;
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
  await admin.end();
});

const run = async (role: "warehouse" | "accounts" | "owner", action: string, input: object) =>
  h.call(await h.login("northfield", role), "POST", `/api/actions/${action}`, input, { "idempotency-key": randomUUID() });

describe("concurrent writes to one row", () => {
  it("never takes stock below zero", async () => {
    const line = inNorth(data.stockLevels).filter((s) => s.onHand >= 30 && s.onHand < 200).at(-1)!;
    const { rows } = await admin.query("select on_hand from stock_levels where product_id = $1 and warehouse_id = $2", [line.productId, line.warehouseId]);
    const onHand = rows[0].on_hand as number;
    const sku = data.products.find((p) => p.id === line.productId)!.sku;
    const wh = data.warehouses.find((w) => w.id === line.warehouseId)!.code;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => run("warehouse", "adjustStock", { sku, warehouseCode: wh, delta: -onHand, reason: "race test" })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const after = await admin.query("select on_hand from stock_levels where product_id = $1 and warehouse_id = $2", [line.productId, line.warehouseId]);
    expect(after.rows[0].on_hand).toBe(0);
  });

  it("keeps an invoice's paid amount equal to its payments", async () => {
    const inv = inNorth(data.invoices).filter((i) => i.status === "open" && i.totalCents > 50_000).at(-1)!;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => run("accounts", "recordPayment", { invoiceNumber: inv.number, amountCents: 1000, method: "card", reference: `RACE-${i}` })),
    );
    const { rows } = await admin.query(
      "select i.paid_cents::int as paid, (select coalesce(sum(amount_cents), 0)::int from payments p where p.invoice_id = i.id) as sum from invoices i where i.id = $1",
      [inv.id],
    );
    expect(rows[0].paid).toBe(rows[0].sum);
    expect(rows[0].paid).toBe(10_000);
  });

  it("lets only one of an approve and a reject win", async () => {
    const req = inNorth(data.approvalRequests).filter((a) => a.kind === "discount" && a.status === "pending").at(-1)!;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        run("owner", "decideApproval", { requestId: req.id, decision: i % 2 ? "reject" : "approve", reason: `decision ${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});

describe("approval details", () => {
  it("never shows a sales rep a credit limit", async () => {
    const res = await h.call(await h.login("northfield", "sales_rep"), "POST", "/api/tools/listApprovals", { status: ["pending", "approved"] });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/LimitCents/);
    const acc = await h.call(await h.login("northfield", "accounts"), "POST", "/api/tools/listApprovals", {});
    expect(JSON.stringify(acc.body)).toMatch(/requestedLimitCents/);
  });

  it("only seeds requests for customers the rep owns", () => {
    const rep = data.users.find((u) => u.tenantId === north.id && u.role === "sales_rep")!;
    for (const r of inNorth(data.approvalRequests).filter((x) => x.requestedBy === rep.id && x.customerId)) {
      expect(data.customers.find((c) => c.id === r.customerId)!.ownerUserId).toBe(rep.id);
    }
  });
});

describe("tokens", () => {
  it("refuses a correctly signed token for a user that does not exist", async () => {
    const token = signToken(
      { sub: randomUUID() as UserId, tid: north.id as TenantId, role: "owner", name: "ghost" },
      loadConfig({ NODE_ENV: "test" }).jwtSecret,
      3600,
    );
    expect((await h.call(token, "POST", "/api/tools/getMargins", {})).status).toBe(401);
  });

  it("refuses to start in production with a published secret", () => {
    expect(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "replace-with-at-least-32-random-characters" })).toThrow();
    expect(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "" })).toThrow();
  });
});

describe("session store", () => {
  it("keeps one user's conversation when another user opens hundreds", () => {
    const store = new SessionStore();
    const scope = (u: string): Scope => ({ tenantId: "t" as TenantId, userId: u as UserId, role: "owner" });
    const init = { userName: "x", tenant: { name: "t", currency: "USD" } };
    const mine = store.get(undefined, scope("me"), init, randomUUID);
    for (let i = 0; i < 6000; i++) store.get(undefined, scope("other"), init, randomUUID);
    expect(store.get(mine.contextId, scope("me"), init, randomUUID).contextId).toBe(mine.contextId);
  });
});
