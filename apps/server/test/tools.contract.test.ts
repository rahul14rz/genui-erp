import { ROLES, type Role } from "@genui-erp/db";
import { generate } from "@genui-erp/db/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signToken } from "../src/auth/jwt.ts";
import { loadConfig } from "../src/config.ts";
import { ROLE_PERMISSIONS } from "../src/generated/permissions.ts";
import { TOOLS } from "../src/tools/registry.ts";
import { ANCHOR, startHarness, type Harness } from "./harness.ts";

const data = generate(ANCHOR);
const tenantOf = (slug: string) => data.tenants.find((t) => t.slug === slug)!;
const north = tenantOf("northfield");
const coast = tenantOf("coastline");
const userOf = (tenantId: string, role: Role) => data.users.find((u) => u.tenantId === tenantId && u.role === role)!;
const rep = userOf(north.id, "sales_rep");
const repCustomer = data.customers.find((c) => c.tenantId === north.id && c.ownerUserId === rep.id)!;
const houseCustomer = data.customers.find((c) => c.tenantId === north.id && c.ownerUserId !== rep.id)!;
const repOrder = data.salesOrders.find((o) => o.customerId === repCustomer.id && o.status === "delivered")!;
const houseOrder = data.salesOrders.find((o) => o.customerId === houseCustomer.id)!;
const coastOrder = data.salesOrders.find((o) => o.tenantId === coast.id)!;

// A valid input for each tool that every permitted Northfield role can see.
const SAMPLE: Record<string, unknown> = {
  listOrders: { limit: 5 },
  getOrder: { number: repOrder.number },
  getDispatchQueue: {},
  getStockLevels: { belowReorder: true },
  listPurchaseOrders: {},
  listCustomers: {},
  getCustomer: { code: repCustomer.code },
  getCustomerLedger: { customerCode: repCustomer.code },
  listInvoices: { overdue: true },
  getSalesSummary: { groupBy: "month", from: "2026-01-01" },
  getMargins: { groupBy: "category" },
  listApprovals: {},
};

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe("auth", () => {
  it("logs in every seeded user", async () => {
    for (const tenant of ["northfield", "coastline"] as const) {
      for (const role of ROLES) expect(await h.login(tenant, role)).toMatch(/^ey/);
    }
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const wrong = await h.app.inject({ method: "POST", url: "/auth/login", payload: { email: "owner@northfield.test", password: "nope" } });
    const unknown = await h.app.inject({ method: "POST", url: "/auth/login", payload: { email: "nobody@northfield.test", password: "nope" } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("rejects missing, forged and expired tokens", async () => {
    const claims = { sub: rep.id, tid: north.id, role: "owner", name: "x" } as never;
    const forged = signToken(claims, "x".repeat(40), 3600);
    const expired = signToken(claims, loadConfig({ NODE_ENV: "test" }).jwtSecret, 60, Date.now() - 3_600_000);
    for (const token of ["", forged, expired]) {
      const res = await h.call(token, "GET", "/me");
      expect(res.status).toBe(401);
    }
  });

  it("serves health without a token", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });
});

describe.each(ROLES)("tools as %s", (role) => {
  it("lists exactly the tools the role's permissions allow", async () => {
    const token = await h.login("northfield", role);
    const res = await h.call(token, "GET", "/api/tools");
    const granted = new Set<string>(ROLE_PERMISSIONS[role]);
    expect(res.body.map((t: { name: string }) => t.name).sort()).toEqual(
      TOOLS.filter((t) => granted.has(t.permission)).map((t) => t.name).sort(),
    );
  });

  it.each(TOOLS.map((t) => t.name))("%s is allowed or refused per permissions", async (tool) => {
    const token = await h.login("northfield", role);
    const res = await h.call(token, "POST", `/api/tools/${tool}`, SAMPLE[tool]);
    const allowed = TOOLS.find((t) => t.name === tool)!;
    if ((ROLE_PERMISSIONS[role] as readonly string[]).includes(allowed.permission)) {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.source.tables.length).toBeGreaterThan(0);
      expect(res.body.source.at).toBe("2026-06-30T12:00:00.000Z");
    } else {
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe(`Tool ${tool} is not available to you.`);
    }
  });
});

describe("field-level visibility", () => {
  const run = async (role: Role, tool: string, input: unknown) =>
    (await h.call(await h.login("northfield", role), "POST", `/api/tools/${tool}`, input)).body.data;

  it("shows order values to owner and rep, not to warehouse", async () => {
    expect((await run("owner", "listOrders", {})).rows[0]).toHaveProperty("valueCents");
    expect((await run("sales_rep", "listOrders", {})).rows[0]).toHaveProperty("valueCents");
    expect((await run("warehouse", "listOrders", {})).rows[0]).not.toHaveProperty("valueCents");
  });

  it("shows margin on an order only to the owner", async () => {
    const owner = await run("owner", "getOrder", { number: repOrder.number });
    const repView = await run("sales_rep", "getOrder", { number: repOrder.number });
    const wh = await run("warehouse", "getOrder", { number: repOrder.number });
    expect(owner).toHaveProperty("marginCents");
    expect(owner.lines[0]).toHaveProperty("unitCostCents");
    expect(repView).toHaveProperty("totalCents");
    expect(repView).not.toHaveProperty("marginCents");
    expect(repView.lines[0]).not.toHaveProperty("unitCostCents");
    expect(wh).not.toHaveProperty("totalCents");
    expect(wh.lines[0]).not.toHaveProperty("unitPriceCents");
  });

  it("shows credit limits to owner and accounts only", async () => {
    expect((await run("accounts", "listCustomers", {})).rows[0]).toHaveProperty("creditLimitCents");
    expect((await run("sales_rep", "listCustomers", {})).rows[0]).not.toHaveProperty("creditLimitCents");
    expect((await run("warehouse", "listCustomers", {})).rows[0]).not.toHaveProperty("creditLimitCents");
  });

  it("hides customer notes from warehouse", async () => {
    const wh = await run("warehouse", "getCustomer", { code: repCustomer.code });
    expect(wh).not.toHaveProperty("notes");
    expect(wh).not.toHaveProperty("accountOwner");
    expect(await run("sales_rep", "getCustomer", { code: repCustomer.code })).toHaveProperty("notes");
  });

  it("limits a rep's sales summary to their own customers", async () => {
    const owner = await run("owner", "getSalesSummary", { groupBy: "customer", from: "2026-01-01", limit: 60 });
    const repView = await run("sales_rep", "getSalesSummary", { groupBy: "customer", from: "2026-01-01", limit: 60 });
    const repCodes = new Set(data.customers.filter((c) => c.ownerUserId === rep.id).map((c) => c.code));
    expect(repView.rows.every((r: { key: string }) => repCodes.has(r.key))).toBe(true);
    expect(repView.totals.revenueCents).toBeLessThan(owner.totals.revenueCents);
  });
});

describe("rows outside the user's reach", () => {
  it("answers another tenant's order the same as a missing one", async () => {
    const token = await h.login("northfield", "owner");
    const other = await h.call(token, "POST", "/api/tools/getOrder", { number: coastOrder.number });
    const missing = await h.call(token, "POST", "/api/tools/getOrder", { number: "SO-99999" });
    expect(coastOrder.number).toMatch(/^SO-/);
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(other.body.error.code).toBe(missing.body.error.code);
  });

  it("hides house-account orders from the sales rep", async () => {
    const token = await h.login("northfield", "sales_rep");
    expect((await h.call(token, "POST", "/api/tools/getOrder", { number: houseOrder.number })).status).toBe(404);
  });

  it("never returns another tenant's customers in a list", async () => {
    const token = await h.login("northfield", "owner");
    const res = await h.call(token, "POST", "/api/tools/listCustomers", { limit: 100 });
    const coastNames = new Set(data.customers.filter((c) => c.tenantId === coast.id).map((c) => c.code + c.name));
    expect(res.body.data.rows.some((r: { code: string; name: string }) => coastNames.has(r.code + r.name))).toBe(false);
  });

  it("rejects invalid tool input with 400", async () => {
    const token = await h.login("northfield", "owner");
    const res = await h.call(token, "POST", "/api/tools/listOrders", { limit: 5000 });
    expect(res.status).toBe(400);
  });
});
