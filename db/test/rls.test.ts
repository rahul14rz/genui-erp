import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ROLES, withScope, type Role, type Scope, type TenantId, type UserId } from "../src/index.ts";
import { generate, type Dataset } from "../seed/generate.ts";
import { TEST_ANCHOR, TEST_APP_URL } from "./env.ts";

// The expected visibility is written here in TypeScript, independently of the
// SQL policies, and checked against what Postgres actually returns.
const data = generate(TEST_ANCHOR);
const pool = new pg.Pool({ connectionString: TEST_APP_URL, max: 4 });
afterAll(() => pool.end());

type Ctx = { tenantId: string; userId: string; d: Dataset };
type Rule = ((row: Record<string, unknown>, ctx: Ctx) => boolean) | "denied";
type TableSpec = { key: keyof Dataset; table: string; id: (r: any) => string; idSql: string };

const TABLES: TableSpec[] = [
  { key: "tenants", table: "tenants", id: (r) => r.id, idSql: "id::text" },
  { key: "users", table: "users", id: (r) => r.id, idSql: "id::text" },
  { key: "customers", table: "customers", id: (r) => r.id, idSql: "id::text" },
  { key: "products", table: "products", id: (r) => r.id, idSql: "id::text" },
  { key: "warehouses", table: "warehouses", id: (r) => r.id, idSql: "id::text" },
  {
    key: "stockLevels",
    table: "stock_levels",
    id: (r) => `${r.productId}:${r.warehouseId}`,
    idSql: "product_id::text || ':' || warehouse_id::text",
  },
  { key: "salesOrders", table: "sales_orders", id: (r) => r.id, idSql: "id::text" },
  { key: "salesOrderLines", table: "sales_order_lines", id: (r) => r.id, idSql: "id::text" },
  { key: "quotes", table: "quotes", id: (r) => r.id, idSql: "id::text" },
  { key: "purchaseOrders", table: "purchase_orders", id: (r) => r.id, idSql: "id::text" },
  { key: "purchaseOrderLines", table: "purchase_order_lines", id: (r) => r.id, idSql: "id::text" },
  { key: "dispatches", table: "dispatches", id: (r) => r.id, idSql: "id::text" },
  { key: "dispatchEvents", table: "dispatch_events", id: (r) => r.id, idSql: "id::text" },
  { key: "invoices", table: "invoices", id: (r) => r.id, idSql: "id::text" },
  { key: "payments", table: "payments", id: (r) => r.id, idSql: "id::text" },
  { key: "ledgerEntries", table: "ledger_entries", id: (r) => r.id, idSql: "id::text" },
  { key: "approvalRequests", table: "approval_requests", id: (r) => r.id, idSql: "id::text" },
];

const all: Rule = () => true;
const repCustomer = (customerId: unknown, c: Ctx) =>
  c.d.customers.some((x) => x.id === customerId && x.ownerUserId === c.userId);
const repOrder = (orderId: unknown, c: Ctx) =>
  c.d.salesOrders.some((o) => o.id === orderId && repCustomer(o.customerId, c));

const ACCESS: Record<Role, Partial<Record<keyof Dataset, Rule>>> = {
  owner: Object.fromEntries(TABLES.map((t) => [t.key, all])),
  sales_rep: {
    tenants: all,
    users: all,
    warehouses: all,
    products: all,
    stockLevels: all,
    customers: (r, c) => r.ownerUserId === c.userId,
    salesOrders: (r, c) => repCustomer(r.customerId, c),
    salesOrderLines: (r, c) => repOrder(r.orderId, c),
    dispatches: (r, c) => repOrder(r.orderId, c),
    dispatchEvents: (r, c) => c.d.dispatches.some((x) => x.id === r.dispatchId && repOrder(x.orderId, c)),
    quotes: (r, c) => r.createdBy === c.userId,
    approvalRequests: (r, c) => r.requestedBy === c.userId,
  },
  warehouse: {
    tenants: all,
    users: all,
    warehouses: all,
    customers: all,
    products: all,
    stockLevels: all,
    salesOrders: all,
    salesOrderLines: all,
    purchaseOrders: all,
    purchaseOrderLines: all,
    dispatches: all,
    dispatchEvents: all,
  },
  accounts: {
    tenants: all,
    users: all,
    warehouses: all,
    customers: all,
    salesOrders: all,
    invoices: all,
    payments: all,
    ledgerEntries: all,
    approvalRequests: (r) => r.kind === "credit_override",
  },
};

const scopeFor = (tenantSlug: string, role: Role): Scope => {
  const tenant = data.tenants.find((t) => t.slug === tenantSlug)!;
  const user = data.users.find((u) => u.tenantId === tenant.id && u.role === role)!;
  return { tenantId: tenant.id as TenantId, userId: user.id as UserId, role };
};

const pgCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (err) {
    return (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
  }
};

describe.each(["northfield", "coastline"])("tenant %s", (slug) => {
  describe.each(ROLES)("role %s", (role) => {
    const scope = scopeFor(slug, role);
    const ctx: Ctx = { tenantId: scope.tenantId, userId: scope.userId, d: data };

    it.each(TABLES)("sees exactly the expected rows of $table", async (spec) => {
      const rule = ACCESS[role][spec.key] ?? "denied";
      const query = withScope(pool, scope, async (db) => {
        const res = await db.execute(sql.raw(`select ${spec.idSql} as id from ${spec.table}`));
        return res.rows.map((r) => r.id as string).sort();
      });
      if (rule === "denied") {
        expect(await pgCode(query)).toBe("42501");
        return;
      }
      const rows = data[spec.key] as Record<string, unknown>[];
      const expected = rows
        .filter((r) => (spec.key === "tenants" ? r.id : r.tenantId) === ctx.tenantId)
        .filter((r) => rule(r, ctx))
        .map(spec.id)
        .sort();
      const actual = await query;
      expect(actual.length).toBeGreaterThan(0);
      expect(actual).toEqual(expected);
    });
  });
});

describe("column grants", () => {
  const hidden: [Role, string, string][] = [
    ["sales_rep", "products", "cost_cents"],
    ["sales_rep", "sales_order_lines", "unit_cost_cents"],
    ["sales_rep", "customers", "credit_limit_cents"],
    ["warehouse", "products", "price_cents"],
    ["warehouse", "products", "cost_cents"],
    ["warehouse", "sales_order_lines", "unit_price_cents"],
    ["warehouse", "purchase_order_lines", "unit_cost_cents"],
    ["warehouse", "customers", "notes"],
    ["accounts", "sales_order_lines", "unit_cost_cents"],
    ...ROLES.map((r): [Role, string, string] => [r, "users", "password_hash"]),
  ];
  it.each(hidden)("%s cannot read %s.%s", async (role, table, column) => {
    const q = withScope(pool, scopeFor("northfield", role), (db) =>
      db.execute(sql.raw(`select ${column} from ${table} limit 1`)),
    );
    expect(await pgCode(q)).toBe("42501");
  });

  it("owner can read cost and margin inputs", async () => {
    const rows = await withScope(pool, scopeFor("northfield", "owner"), (db) =>
      db.execute(sql.raw("select cost_cents from products limit 1")),
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe("scope edge cases", () => {
  it("a role with no tenant set sees nothing", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role genui_role_owner");
      for (const t of TABLES) {
        const { rows } = await client.query(`select count(*)::int as n from ${t.table}`);
        expect(rows[0].n, t.table).toBe(0);
      }
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("the login role alone has no table access", async () => {
    expect(await pgCode(pool.query("select id from customers limit 1"))).toBe("42501");
  });

  it("a write tagged with another tenant's id is rejected", async () => {
    const north = scopeFor("northfield", "warehouse");
    const coast = data.tenants.find((t) => t.slug === "coastline")!;
    const dispatch = data.dispatches.find((d) => d.tenantId === north.tenantId)!;
    const q = withScope(pool, north, (db) =>
      db.execute(
        sql`insert into dispatch_events (tenant_id, dispatch_id, status, at) values (${coast.id}, ${dispatch.id}, 'packed', now())`,
      ),
    );
    expect(await pgCode(q)).toBe("42501");
  });

  it("an update aimed at another tenant's row changes nothing", async () => {
    const north = scopeFor("northfield", "owner");
    const coastProduct = data.products.find((p) => p.tenantId !== north.tenantId)!;
    const res = await withScope(pool, north, (db) =>
      db.execute(sql`update products set price_cents = 1 where id = ${coastProduct.id}`),
    );
    expect(res.rowCount).toBe(0);
  });

  it("a sales rep cannot file a credit override request", async () => {
    const rep = scopeFor("northfield", "sales_rep");
    const customer = data.customers.find((c) => c.ownerUserId === rep.userId)!;
    const q = withScope(pool, rep, (db) =>
      db.execute(
        sql`insert into approval_requests (tenant_id, kind, status, requested_by, customer_id, payload, reason)
            values (${rep.tenantId}, 'credit_override', 'pending', ${rep.userId}, ${customer.id}, '{}', 'x')`,
      ),
    );
    expect(await pgCode(q)).toBe("42501");
  });

  it("a scope does not leak into the next transaction on the same connection", async () => {
    const single = new pg.Pool({ connectionString: TEST_APP_URL, max: 1 });
    try {
      await withScope(single, scopeFor("northfield", "owner"), (db) => db.execute(sql`select 1`));
      expect(await pgCode(single.query("select id from customers limit 1"))).toBe("42501");
    } finally {
      await single.end();
    }
  });
});
