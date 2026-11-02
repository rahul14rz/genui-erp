import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { resetDatabase } from "../src/admin.ts";
import { generate } from "../seed/generate.ts";
import { TEST_ADMIN_URL, TEST_ANCHOR, TEST_APP_PASSWORD } from "./env.ts";

const CHECKSUM_TABLES = [
  "tenants", "customers", "products", "stock_levels", "sales_orders", "sales_order_lines",
  "dispatches", "dispatch_events", "invoices", "payments", "ledger_entries", "approval_requests",
];

async function checksums(adminUrl: string): Promise<Record<string, string>> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const out: Record<string, string> = {};
    for (const t of CHECKSUM_TABLES) {
      const { rows } = await pool.query(`select md5(string_agg(x::text, '|' order by x::text)) as h from ${t} x`);
      out[t] = rows[0].h;
    }
    return out;
  } finally {
    await pool.end();
  }
}

describe("seed", () => {
  const secondUrl = (() => {
    const u = new URL(TEST_ADMIN_URL);
    u.pathname = "/genui_erp_test_seed_b";
    return u.toString();
  })();
  afterAll(async () => {
    const u = new URL(TEST_ADMIN_URL);
    u.pathname = "/postgres";
    const c = new pg.Client({ connectionString: u.toString() });
    await c.connect();
    await c.query("drop database if exists genui_erp_test_seed_b with (force)");
    await c.end();
  });

  it("produces identical data on two runs with the same anchor", async () => {
    await resetDatabase({ adminUrl: secondUrl, appPassword: TEST_APP_PASSWORD, anchor: TEST_ANCHOR });
    expect(await checksums(secondUrl)).toEqual(await checksums(TEST_ADMIN_URL));
  });

  it("has the shapes the demo relies on in each tenant", () => {
    const d = generate(TEST_ANCHOR);
    const today = TEST_ANCHOR.toISOString().slice(0, 10);
    const fiveDaysAgo = TEST_ANCHOR.getTime() - 5 * 86_400_000;
    for (const t of d.tenants) {
      const mine = <T extends { tenantId: string }>(rows: T[]) => rows.filter((r) => r.tenantId === t.id);
      const overdue = mine(d.invoices).filter((i) => i.status !== "paid" && i.dueAt < today);
      const stuck = mine(d.dispatches).filter(
        (x) => ["queued", "picking", "packed"].includes(x.status) && x.queuedAt.getTime() < fiveDaysAgo,
      );
      const stockedOut = new Set(mine(d.stockLevels).filter((s) => s.onHand === 0).map((s) => s.productId));
      const injected = mine(d.customers).filter((c) => /ignore previous|admin mode|Note to the AI/i.test(c.notes ?? ""));
      expect(overdue.length, t.slug).toBeGreaterThanOrEqual(3);
      expect(stuck.length, t.slug).toBeGreaterThanOrEqual(2);
      expect(stockedOut.size, t.slug).toBeGreaterThanOrEqual(2);
      expect(injected.length, t.slug).toBeGreaterThanOrEqual(2);
      expect(mine(d.users).map((u) => u.role).sort()).toEqual(["accounts", "owner", "sales_rep", "warehouse"]);
    }
  });

  it("follows the seasonality of each trade", () => {
    const d = generate(TEST_ANCHOR);
    const byMonth = (slug: string) => {
      const t = d.tenants.find((x) => x.slug === slug)!;
      const m = new Map<number, number>();
      for (const o of d.salesOrders.filter((x) => x.tenantId === t.id)) {
        const k = o.orderedAt.getUTCMonth();
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    // The window ends on 30 June: hardware peaks in May, garments are quiet
    // in February.
    const coast = byMonth("coastline");
    const north = byMonth("northfield");
    expect(coast.get(4)!).toBeGreaterThan(coast.get(1)!);
    expect(north.get(1)!).toBeLessThan(north.get(4)!);
  });
});
