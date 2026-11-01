import { products, purchaseOrderLines, purchaseOrders, stockLevels, warehouses } from "@genui-erp/db";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { defineTool, filtersOf, page } from "./types.ts";

export const getStockLevels = defineTool({
  name: "getStockLevels",
  description:
    "Stock on hand, reserved and available by product and warehouse. Filter by SKU or name search, warehouse code, or only lines at or below their reorder point.",
  permission: "stock:read",
  input: z.object({
    search: z.string().max(40).optional(),
    warehouseCode: z.string().optional(),
    belowReorder: z.boolean().optional(),
    ...page,
  }),
  output: z.strictObject({
    total: z.number(),
    rows: z.array(
      z.strictObject({
        sku: z.string(),
        product: z.string(),
        category: z.string(),
        warehouse: z.string(),
        onHand: z.number(),
        reserved: z.number(),
        available: z.number(),
        reorderPoint: z.number(),
        status: z.enum(["ok", "low", "out"]),
      }),
    ),
  }),
  async run({ db }, input) {
    const where: SQL[] = [];
    if (input.search) {
      where.push(or(ilike(products.sku, `%${input.search}%`), ilike(products.name, `%${input.search}%`))!);
    }
    if (input.warehouseCode) where.push(eq(warehouses.code, input.warehouseCode));
    if (input.belowReorder) where.push(sql`${stockLevels.onHand} - ${stockLevels.reserved} <= ${stockLevels.reorderPoint}`);
    const rows = await db
      .select({
        sku: products.sku,
        product: products.name,
        category: products.category,
        warehouse: warehouses.name,
        onHand: stockLevels.onHand,
        reserved: stockLevels.reserved,
        reorderPoint: stockLevels.reorderPoint,
        total: sql<number>`count(*) over ()::int`,
      })
      .from(stockLevels)
      .innerJoin(products, eq(products.id, stockLevels.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockLevels.warehouseId))
      .where(and(...where))
      .orderBy(asc(sql`${stockLevels.onHand} - ${stockLevels.reserved} - ${stockLevels.reorderPoint}`), asc(products.sku))
      .limit(input.limit)
      .offset(input.offset);
    return {
      data: {
        total: rows[0]?.total ?? 0,
        rows: rows.map(({ total: _t, ...r }) => {
          const available = r.onHand - r.reserved;
          return {
            ...r,
            available,
            status: r.onHand === 0 ? ("out" as const) : available <= r.reorderPoint ? ("low" as const) : ("ok" as const),
          };
        }),
      },
      source: { tables: ["stock_levels", "products", "warehouses"], filters: filtersOf(input) },
    };
  },
});

const PO_STATUS = ["open", "partial", "received", "cancelled"] as const;

export const listPurchaseOrders = defineTool({
  name: "listPurchaseOrders",
  description: "Purchase orders from suppliers with received quantities, newest first. Filter by status.",
  permission: "purchasing:read",
  input: z.object({ status: z.array(z.enum(PO_STATUS)).optional(), ...page }),
  output: z.strictObject({
    total: z.number(),
    rows: z.array(
      z.strictObject({
        number: z.string(),
        supplier: z.string(),
        warehouse: z.string(),
        status: z.enum(PO_STATUS),
        orderedAt: z.string(),
        expectedAt: z.string(),
        qty: z.number(),
        receivedQty: z.number(),
      }),
    ),
  }),
  async run({ db }, input) {
    const rows = await db
      .select({
        number: purchaseOrders.number,
        supplier: purchaseOrders.supplierName,
        warehouse: warehouses.name,
        status: purchaseOrders.status,
        orderedAt: purchaseOrders.orderedAt,
        expectedAt: purchaseOrders.expectedAt,
        qty: sql<number>`sum(${purchaseOrderLines.qty})::int`,
        receivedQty: sql<number>`sum(${purchaseOrderLines.receivedQty})::int`,
        total: sql<number>`count(*) over ()::int`,
      })
      .from(purchaseOrders)
      .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
      .where(input.status?.length ? inArray(purchaseOrders.status, input.status) : undefined)
      .groupBy(purchaseOrders.id, warehouses.id)
      .orderBy(desc(purchaseOrders.orderedAt))
      .limit(input.limit)
      .offset(input.offset);
    return {
      data: {
        total: rows[0]?.total ?? 0,
        rows: rows.map(({ total: _t, ...r }) => ({ ...r, orderedAt: r.orderedAt.toISOString() })),
      },
      source: { tables: ["purchase_orders", "purchase_order_lines", "warehouses"], filters: filtersOf(input) },
    };
  },
});
