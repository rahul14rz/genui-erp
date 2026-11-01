import {
  customers,
  dispatchEvents,
  dispatches,
  products,
  salesOrderLines,
  salesOrders,
  warehouses,
} from "@genui-erp/db";
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { defineTool, filtersOf, isoDate, page } from "./types.ts";

const ORDER_STATUS = ["confirmed", "picking", "packed", "dispatched", "delivered", "cancelled"] as const;
const DISPATCH_STATUS = ["queued", "picking", "packed", "dispatched", "delivered"] as const;

const lineValue = sql<number>`coalesce(sum(round(${salesOrderLines.qty} * ${salesOrderLines.unitPriceCents} * (1 - ${salesOrderLines.discountPct} / 100.0))), 0)::bigint`;

export const listOrders = defineTool({
  name: "listOrders",
  description:
    "List sales orders, newest first. Filter by status, customer code, order date range or order number search. Order values are included only for roles that can see prices.",
  permission: "orders:read",
  input: z.object({
    status: z.array(z.enum(ORDER_STATUS)).optional(),
    customerCode: z.string().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    search: z.string().max(40).optional(),
    sort: z.enum(["orderedAt", "requiredBy", "value"]).default("orderedAt"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    ...page,
  }),
  output: z.strictObject({
    total: z.number(),
    rows: z.array(
      z.strictObject({
        number: z.string(),
        customer: z.string(),
        customerCode: z.string(),
        status: z.enum(ORDER_STATUS),
        orderedAt: z.string(),
        requiredBy: z.string(),
        lines: z.number(),
        valueCents: z.number().optional(),
      }),
    ),
  }),
  async run({ db, can }, input) {
    const showValue = can("prices:read");
    const where: SQL[] = [];
    if (input.status?.length) where.push(inArray(salesOrders.status, input.status));
    if (input.customerCode) where.push(eq(customers.code, input.customerCode));
    if (input.from) where.push(gte(salesOrders.orderedAt, new Date(`${input.from}T00:00:00Z`)));
    if (input.to) where.push(lte(salesOrders.orderedAt, new Date(`${input.to}T23:59:59Z`)));
    if (input.search) where.push(ilike(salesOrders.number, `%${input.search}%`));
    const dir = input.direction === "asc" ? asc : desc;
    const byValue = input.sort === "value" && showValue;
    const sortCol = input.sort === "requiredBy" ? salesOrders.requiredBy : salesOrders.orderedAt;

    // Pick the page of orders first and aggregate lines for those orders only.
    // Aggregating every visible order before the limit was most of the cost.
    // Sorting by value has to aggregate everything, so it keeps the slow path.
    const page = await db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        customer: customers.name,
        customerCode: customers.code,
        status: salesOrders.status,
        orderedAt: salesOrders.orderedAt,
        requiredBy: salesOrders.requiredBy,
        total: sql<number>`count(*) over ()::int`,
        ...(byValue ? { valueSort: lineValue } : {}),
      })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .leftJoin(salesOrderLines, byValue ? eq(salesOrderLines.orderId, salesOrders.id) : sql`false`)
      .where(and(...where))
      .groupBy(salesOrders.id, customers.id)
      .orderBy(byValue ? dir(lineValue) : dir(sortCol), desc(salesOrders.number))
      .limit(input.limit)
      .offset(input.offset);
    const ids = page.map((o) => o.id);
    const agg = ids.length
      ? await db
          .select({
            orderId: salesOrderLines.orderId,
            lines: sql<number>`count(*)::int`,
            ...(showValue ? { valueCents: lineValue } : {}),
          })
          .from(salesOrderLines)
          .where(inArray(salesOrderLines.orderId, ids))
          .groupBy(salesOrderLines.orderId)
      : [];
    const byOrder = new Map(agg.map((a) => [a.orderId, a]));
    const rows = page.map(({ id, total: _t, valueSort: _v, ...o }) => {
      const a = byOrder.get(id);
      return {
        ...o,
        lines: a?.lines ?? 0,
        ...(showValue ? { valueCents: (a as { valueCents?: number } | undefined)?.valueCents ?? 0 } : {}),
      };
    });
    const count = { n: page[0]?.total ?? 0 };
    return {
      data: {
        total: count?.n ?? 0,
        rows: rows.map((r) => ({ ...r, orderedAt: r.orderedAt.toISOString() })),
      },
      source: { tables: ["sales_orders", "customers", "sales_order_lines"], filters: filtersOf(input) },
    };
  },
});

export const getOrder = defineTool({
  name: "getOrder",
  description:
    "Get one sales order by number with its lines, dispatch details and status history. Prices and margin appear only for roles that can see them.",
  permission: "orders:read",
  input: z.object({ number: z.string().min(1) }),
  output: z.strictObject({
    number: z.string(),
    status: z.enum(ORDER_STATUS),
    orderedAt: z.string(),
    requiredBy: z.string(),
    notes: z.string().nullable(),
    customer: z.strictObject({ code: z.string(), name: z.string(), city: z.string() }),
    lines: z.array(
      z.strictObject({
        sku: z.string(),
        product: z.string(),
        qty: z.number(),
        unitPriceCents: z.number().optional(),
        discountPct: z.number().optional(),
        lineTotalCents: z.number().optional(),
        unitCostCents: z.number().optional(),
        marginCents: z.number().optional(),
      }),
    ),
    totalCents: z.number().optional(),
    marginCents: z.number().optional(),
    dispatch: z
      .strictObject({
        status: z.enum(DISPATCH_STATUS),
        warehouse: z.string(),
        carrier: z.string().nullable(),
        queuedAt: z.string(),
        dispatchedAt: z.string().nullable(),
      })
      .nullable(),
    timeline: z.array(z.strictObject({ status: z.enum(DISPATCH_STATUS), at: z.string(), note: z.string().nullable() })),
  }),
  async run({ db, can }, input) {
    const [order] = await db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        status: salesOrders.status,
        orderedAt: salesOrders.orderedAt,
        requiredBy: salesOrders.requiredBy,
        notes: salesOrders.notes,
        code: customers.code,
        name: customers.name,
        city: customers.city,
      })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(eq(salesOrders.number, input.number));
    if (!order) throw new AppError("not_found", `No order ${input.number} is visible to you.`);

    const showPrice = can("prices:read");
    const showMargin = can("margin:read");
    const lines = await db
      .select({
        sku: products.sku,
        product: products.name,
        qty: salesOrderLines.qty,
        ...(showPrice
          ? { unitPriceCents: salesOrderLines.unitPriceCents, discountPct: salesOrderLines.discountPct }
          : {}),
        ...(showMargin ? { unitCostCents: salesOrderLines.unitCostCents } : {}),
      })
      .from(salesOrderLines)
      .innerJoin(products, eq(products.id, salesOrderLines.productId))
      .where(eq(salesOrderLines.orderId, order.id))
      .orderBy(products.sku);

    const priced = lines.map((l) => {
      if (l.unitPriceCents === undefined || l.discountPct === undefined) return l;
      const lineTotalCents = Math.round(l.qty * l.unitPriceCents * (1 - l.discountPct / 100));
      return {
        ...l,
        lineTotalCents,
        ...(l.unitCostCents !== undefined ? { marginCents: lineTotalCents - l.qty * l.unitCostCents } : {}),
      };
    });

    const [dispatch] = await db
      .select({
        id: dispatches.id,
        status: dispatches.status,
        warehouse: warehouses.name,
        carrier: dispatches.carrier,
        queuedAt: dispatches.queuedAt,
        dispatchedAt: dispatches.dispatchedAt,
      })
      .from(dispatches)
      .innerJoin(warehouses, eq(warehouses.id, dispatches.warehouseId))
      .where(eq(dispatches.orderId, order.id));
    const timeline = dispatch
      ? await db
          .select({ status: dispatchEvents.status, at: dispatchEvents.at, note: dispatchEvents.note })
          .from(dispatchEvents)
          .where(eq(dispatchEvents.dispatchId, dispatch.id))
          .orderBy(asc(dispatchEvents.at))
      : [];

    const sum = (k: "lineTotalCents" | "marginCents") =>
      priced.reduce((a, l) => a + ((k in l ? (l as { [x: string]: unknown })[k] : 0) as number), 0);
    return {
      data: {
        number: order.number,
        status: order.status,
        orderedAt: order.orderedAt.toISOString(),
        requiredBy: order.requiredBy,
        notes: order.notes,
        customer: { code: order.code, name: order.name, city: order.city },
        lines: priced,
        ...(showPrice ? { totalCents: sum("lineTotalCents") } : {}),
        ...(showMargin ? { marginCents: sum("marginCents") } : {}),
        dispatch: dispatch
          ? {
              status: dispatch.status,
              warehouse: dispatch.warehouse,
              carrier: dispatch.carrier,
              queuedAt: dispatch.queuedAt.toISOString(),
              dispatchedAt: dispatch.dispatchedAt?.toISOString() ?? null,
            }
          : null,
        timeline: timeline.map((e) => ({ ...e, at: e.at.toISOString() })),
      },
      source: {
        tables: ["sales_orders", "sales_order_lines", "products", "dispatches", "dispatch_events"],
        filters: { number: input.number },
      },
    };
  },
});

export const getDispatchQueue = defineTool({
  name: "getDispatchQueue",
  description:
    "Orders waiting to leave a warehouse (queued, picking or packed), oldest first, with how many days each has waited. Use olderThanDays to find stuck orders.",
  permission: "dispatch:read",
  input: z.object({
    olderThanDays: z.number().int().min(0).max(60).optional(),
    status: z.array(z.enum(["queued", "picking", "packed"])).optional(),
    warehouseCode: z.string().optional(),
    ...page,
  }),
  output: z.strictObject({
    total: z.number(),
    rows: z.array(
      z.strictObject({
        orderNumber: z.string(),
        customer: z.string(),
        city: z.string(),
        warehouse: z.string(),
        status: z.enum(["queued", "picking", "packed"]),
        queuedAt: z.string(),
        ageDays: z.number(),
        requiredBy: z.string(),
        lastNote: z.string().nullable(),
      }),
    ),
  }),
  async run({ db, now }, input) {
    const statuses = input.status?.length ? input.status : (["queued", "picking", "packed"] as const);
    const where: SQL[] = [inArray(dispatches.status, [...statuses])];
    if (input.olderThanDays !== undefined) {
      where.push(lte(dispatches.queuedAt, new Date(now.getTime() - input.olderThanDays * 86_400_000)));
    }
    if (input.warehouseCode) where.push(eq(warehouses.code, input.warehouseCode));
    const lastNote = sql<string | null>`(select e.note from ${dispatchEvents} e where e.dispatch_id = ${dispatches.id} and e.note is not null order by e.at desc limit 1)`;
    const rows = await db
      .select({
        orderNumber: salesOrders.number,
        customer: customers.name,
        city: customers.city,
        warehouse: warehouses.name,
        status: dispatches.status,
        queuedAt: dispatches.queuedAt,
        requiredBy: salesOrders.requiredBy,
        lastNote,
        total: sql<number>`count(*) over ()::int`,
      })
      .from(dispatches)
      .innerJoin(salesOrders, eq(salesOrders.id, dispatches.orderId))
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .innerJoin(warehouses, eq(warehouses.id, dispatches.warehouseId))
      .where(and(...where))
      .orderBy(asc(dispatches.queuedAt))
      .limit(input.limit)
      .offset(input.offset);
    return {
      data: {
        total: rows[0]?.total ?? 0,
        rows: rows.map(({ total: _t, ...r }) => ({
          ...r,
          status: r.status as "queued" | "picking" | "packed",
          queuedAt: r.queuedAt.toISOString(),
          ageDays: Math.floor((now.getTime() - r.queuedAt.getTime()) / 86_400_000),
        })),
      },
      source: { tables: ["dispatches", "sales_orders", "customers", "warehouses", "dispatch_events"], filters: filtersOf(input) },
    };
  },
});
