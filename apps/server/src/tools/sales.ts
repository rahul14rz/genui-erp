import { approvalRequests, customers, products, salesOrderLines, salesOrders, users } from "@genui-erp/db";
import { and, desc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { daysAgo, defineTool, filtersOf, isoDate, page } from "./types.ts";

const GROUP = ["month", "week", "customer", "category", "product"] as const;

const revenue = sql<number>`coalesce(sum(round(${salesOrderLines.qty} * ${salesOrderLines.unitPriceCents} * (1 - ${salesOrderLines.discountPct} / 100.0))), 0)::bigint`;
const cost = sql<number>`coalesce(sum(${salesOrderLines.qty} * ${salesOrderLines.unitCostCents}), 0)::bigint`;

function groupKey(groupBy: (typeof GROUP)[number]) {
  switch (groupBy) {
    case "month":
      return { key: sql<string>`to_char(date_trunc('month', ${salesOrders.orderedAt}), 'YYYY-MM')`, label: sql<string>`to_char(date_trunc('month', ${salesOrders.orderedAt}), 'Mon YYYY')` };
    case "week":
      return { key: sql<string>`to_char(date_trunc('week', ${salesOrders.orderedAt}), 'YYYY-MM-DD')`, label: sql<string>`to_char(date_trunc('week', ${salesOrders.orderedAt}), 'DD Mon')` };
    case "customer":
      return { key: sql<string>`${customers.code}`, label: sql<string>`${customers.name}` };
    case "category":
      return { key: sql<string>`${products.category}`, label: sql<string>`${products.category}` };
    case "product":
      return { key: sql<string>`${products.sku}`, label: sql<string>`${products.name}` };
  }
}

const range = (input: { from?: string | undefined; to?: string | undefined }, now: Date) => {
  const from = input.from ?? daysAgo(now, 30);
  const to = input.to ?? now.toISOString().slice(0, 10);
  const span = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime() + 86_400_000;
  const prevTo = new Date(new Date(`${from}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(`${from}T00:00:00Z`).getTime() - span).toISOString().slice(0, 10);
  return { from, to, prevFrom, prevTo };
};
const between = (from: string, to: string): SQL =>
  and(
    gte(salesOrders.orderedAt, new Date(`${from}T00:00:00Z`)),
    lte(salesOrders.orderedAt, new Date(`${to}T23:59:59Z`)),
    ne(salesOrders.status, "cancelled"),
  )!;

const groupInput = {
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.number().int().min(1).max(60).default(24),
};

export const getSalesSummary = defineTool({
  name: "getSalesSummary",
  description:
    "Revenue and order count for a date range (default last 30 days), grouped by month, week, customer, category or product, plus totals for the range and the equal-length period before it. Excludes cancelled orders.",
  permission: "sales:read",
  input: z.object({ groupBy: z.enum(GROUP).default("month"), ...groupInput }),
  output: z.strictObject({
    from: z.string(),
    to: z.string(),
    totals: z.strictObject({ revenueCents: z.number(), orders: z.number(), avgOrderCents: z.number() }),
    previous: z.strictObject({ revenueCents: z.number(), orders: z.number(), avgOrderCents: z.number() }),
    rows: z.array(z.strictObject({ key: z.string(), label: z.string(), revenueCents: z.number(), orders: z.number() })),
  }),
  async run({ db, now }, input) {
    const r = range(input, now);
    const g = groupKey(input.groupBy);
    const byTime = input.groupBy === "month" || input.groupBy === "week";
    const rows = await db
      .select({ key: g.key, label: g.label, revenueCents: revenue, orders: sql<number>`count(distinct ${salesOrders.id})::int` })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .innerJoin(salesOrderLines, eq(salesOrderLines.orderId, salesOrders.id))
      .innerJoin(products, eq(products.id, salesOrderLines.productId))
      .where(between(r.from, r.to))
      .groupBy(g.key, g.label)
      .orderBy(byTime ? g.key : desc(revenue))
      .limit(input.limit);
    const totalsFor = async (from: string, to: string) => {
      const [t] = await db
        .select({ revenueCents: revenue, orders: sql<number>`count(distinct ${salesOrders.id})::int` })
        .from(salesOrders)
        .innerJoin(salesOrderLines, eq(salesOrderLines.orderId, salesOrders.id))
        .where(between(from, to));
      const revenueCents = t?.revenueCents ?? 0;
      const orders = t?.orders ?? 0;
      return { revenueCents, orders, avgOrderCents: orders ? Math.round(revenueCents / orders) : 0 };
    };
    const [totals, previous] = await Promise.all([totalsFor(r.from, r.to), totalsFor(r.prevFrom, r.prevTo)]);
    return {
      data: { from: r.from, to: r.to, totals, previous, rows },
      source: {
        tables: ["sales_orders", "sales_order_lines", "customers", "products"],
        filters: { ...filtersOf(input), from: r.from, to: r.to, excludes: "cancelled orders" },
      },
    };
  },
});

export const getMargins = defineTool({
  name: "getMargins",
  description:
    "Revenue, cost and gross margin for a date range (default last 30 days), grouped by category, product, customer or month, highest revenue first.",
  permission: "margin:read",
  input: z.object({ groupBy: z.enum(["category", "product", "customer", "month"]).default("category"), ...groupInput }),
  output: z.strictObject({
    from: z.string(),
    to: z.string(),
    totals: z.strictObject({ revenueCents: z.number(), costCents: z.number(), marginCents: z.number(), marginPct: z.number() }),
    rows: z.array(
      z.strictObject({
        key: z.string(),
        label: z.string(),
        revenueCents: z.number(),
        costCents: z.number(),
        marginCents: z.number(),
        marginPct: z.number(),
      }),
    ),
  }),
  async run({ db, now }, input) {
    const r = range(input, now);
    const g = groupKey(input.groupBy);
    const rows = await db
      .select({ key: g.key, label: g.label, revenueCents: revenue, costCents: cost })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .innerJoin(salesOrderLines, eq(salesOrderLines.orderId, salesOrders.id))
      .innerJoin(products, eq(products.id, salesOrderLines.productId))
      .where(between(r.from, r.to))
      .groupBy(g.key, g.label)
      .orderBy(input.groupBy === "month" ? g.key : desc(revenue))
      .limit(input.limit);
    const withMargin = <T extends { revenueCents: number; costCents: number }>(x: T) => ({
      ...x,
      marginCents: x.revenueCents - x.costCents,
      marginPct: x.revenueCents ? Math.round(((x.revenueCents - x.costCents) / x.revenueCents) * 1000) / 10 : 0,
    });
    const [t] = await db
      .select({ revenueCents: revenue, costCents: cost })
      .from(salesOrders)
      .innerJoin(salesOrderLines, eq(salesOrderLines.orderId, salesOrders.id))
      .where(between(r.from, r.to));
    return {
      data: {
        from: r.from,
        to: r.to,
        totals: withMargin(t ?? { revenueCents: 0, costCents: 0 }),
        rows: rows.map(withMargin),
      },
      source: {
        tables: ["sales_orders", "sales_order_lines", "customers", "products"],
        filters: { ...filtersOf(input), from: r.from, to: r.to, excludes: "cancelled orders" },
      },
    };
  },
});

const APPROVAL_STATUS = ["pending", "approved", "rejected"] as const;
const APPROVAL_KIND = ["discount", "credit_override", "price_change"] as const;

export const listApprovals = defineTool({
  name: "listApprovals",
  description:
    "Approval requests the user can see (discounts, credit overrides, price changes), newest first. Defaults to pending.",
  permission: "approvals:read",
  input: z.object({ status: z.array(z.enum(APPROVAL_STATUS)).default(["pending"]), ...page }),
  output: z.strictObject({
    total: z.number(),
    rows: z.array(
      z.strictObject({
        id: z.string(),
        kind: z.enum(APPROVAL_KIND),
        status: z.enum(APPROVAL_STATUS),
        requestedBy: z.string(),
        customer: z.string().nullable(),
        orderNumber: z.string().nullable(),
        reason: z.string(),
        payload: z.record(z.string(), z.unknown()),
        createdAt: z.string(),
      }),
    ),
  }),
  async run({ db }, input) {
    const rows = await db
      .select({
        id: approvalRequests.id,
        kind: approvalRequests.kind,
        status: approvalRequests.status,
        requestedBy: users.name,
        customer: customers.name,
        orderNumber: salesOrders.number,
        reason: approvalRequests.reason,
        payload: approvalRequests.payload,
        createdAt: approvalRequests.createdAt,
        total: sql<number>`count(*) over ()::int`,
      })
      .from(approvalRequests)
      .innerJoin(users, eq(users.id, approvalRequests.requestedBy))
      .leftJoin(customers, eq(customers.id, approvalRequests.customerId))
      .leftJoin(salesOrders, eq(salesOrders.id, approvalRequests.orderId))
      .where(inArray(approvalRequests.status, input.status))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(input.limit)
      .offset(input.offset);
    return {
      data: {
        total: rows[0]?.total ?? 0,
        rows: rows.map(({ total: _t, ...r }) => ({
          ...r,
          payload: r.payload as Record<string, unknown>,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      source: { tables: ["approval_requests", "users", "customers"], filters: filtersOf(input) },
    };
  },
});
