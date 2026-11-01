import {
  approvalRequests,
  customers,
  dispatchEvents,
  dispatches,
  invoices,
  ledgerEntries,
  payments,
  products,
  quotes,
  salesOrderLines,
  salesOrders,
  stockAdjustments,
  stockLevels,
  warehouses,
} from "@genui-erp/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { defineAction, type Change } from "./types.ts";

// Each prepare locks the row it will change, so two requests for the same
// row run one after the other and the second sees the first one's result.
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const reason = z.string().trim().min(3).max(500);

export const markDispatched = defineAction({
  name: "markDispatched",
  description: "Mark an order that is queued, picking or packed as dispatched with a carrier.",
  permission: "dispatch:mark",
  input: z.object({ orderNumber: z.string().min(1), carrier: z.string().trim().min(2).max(80) }),
  async prepare({ db, scope, now }, input) {
    const [row] = await db
      .select({ dispatchId: dispatches.id, dispatchStatus: dispatches.status, orderId: salesOrders.id, orderStatus: salesOrders.status })
      .from(dispatches)
      .innerJoin(salesOrders, eq(salesOrders.id, dispatches.orderId))
      .where(eq(salesOrders.number, input.orderNumber))
      .for("update", { of: dispatches });
    if (!row) throw new AppError("not_found", `No dispatch for order ${input.orderNumber} is visible to you.`);
    if (!["queued", "picking", "packed"].includes(row.dispatchStatus)) {
      throw new AppError("invalid", `Order ${input.orderNumber} is already ${row.dispatchStatus}.`);
    }
    return {
      preview: {
        title: `Dispatch ${input.orderNumber}`,
        summary: `Marks ${input.orderNumber} as dispatched with ${input.carrier}.`,
        changes: [
          { entity: "Dispatch", label: input.orderNumber, field: "status", from: row.dispatchStatus, to: "dispatched" },
          { entity: "Dispatch", label: input.orderNumber, field: "carrier", from: null, to: input.carrier },
          { entity: "Order", label: input.orderNumber, field: "status", from: row.orderStatus, to: "dispatched" },
        ],
      },
      apply: async () => {
        await db
          .update(dispatches)
          .set({ status: "dispatched", dispatchedAt: now, carrier: input.carrier })
          .where(eq(dispatches.id, row.dispatchId));
        await db.update(salesOrders).set({ status: "dispatched" }).where(eq(salesOrders.id, row.orderId));
        await db.insert(dispatchEvents).values({
          tenantId: scope.tenantId,
          dispatchId: row.dispatchId,
          status: "dispatched",
          at: now,
          note: `Carrier ${input.carrier}`,
        });
        return { orderNumber: input.orderNumber, status: "dispatched" };
      },
    };
  },
});

export const adjustStock = defineAction({
  name: "adjustStock",
  description: "Add or remove stock on hand for one product in one warehouse, with a reason.",
  permission: "stock:adjust",
  input: z.object({
    sku: z.string().min(1),
    warehouseCode: z.string().min(1),
    delta: z.number().int().min(-10_000).max(10_000).refine((d) => d !== 0, "delta must not be zero"),
    reason,
  }),
  async prepare({ db, scope }, input) {
    const [row] = await db
      .select({ productId: products.id, warehouseId: warehouses.id, onHand: stockLevels.onHand, product: products.name, warehouse: warehouses.name })
      .from(stockLevels)
      .innerJoin(products, eq(products.id, stockLevels.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockLevels.warehouseId))
      .where(and(eq(products.sku, input.sku), eq(warehouses.code, input.warehouseCode)))
      .for("update", { of: stockLevels });
    if (!row) throw new AppError("not_found", `No stock line for ${input.sku} in ${input.warehouseCode}.`);
    const to = row.onHand + input.delta;
    if (to < 0) throw new AppError("invalid", `Only ${row.onHand} on hand, cannot remove ${-input.delta}.`);
    return {
      preview: {
        title: `Adjust stock for ${input.sku}`,
        summary: `${input.delta > 0 ? "Adds" : "Removes"} ${Math.abs(input.delta)} ${row.product} at ${row.warehouse}. Reason: ${input.reason}`,
        changes: [{ entity: "Stock", label: `${input.sku} at ${input.warehouseCode}`, field: "on hand", from: row.onHand, to }],
      },
      apply: async () => {
        await db
          .update(stockLevels)
          .set({ onHand: sql`${stockLevels.onHand} + ${input.delta}` })
          .where(and(eq(stockLevels.productId, row.productId), eq(stockLevels.warehouseId, row.warehouseId)));
        await db.insert(stockAdjustments).values({
          tenantId: scope.tenantId,
          productId: row.productId,
          warehouseId: row.warehouseId,
          delta: input.delta,
          reason: input.reason,
          userId: scope.userId,
        });
        return { sku: input.sku, warehouseCode: input.warehouseCode, onHand: to };
      },
    };
  },
});

export const requestDiscount = defineAction({
  name: "requestDiscount",
  description: "Ask the owner to approve a discount on an open order.",
  permission: "discounts:request",
  input: z.object({ orderNumber: z.string().min(1), discountPct: z.number().min(1).max(30), reason }),
  async prepare({ db, scope }, input) {
    const [order] = await db
      .select({ id: salesOrders.id, customerId: salesOrders.customerId, status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.number, input.orderNumber));
    if (!order) throw new AppError("not_found", `No order ${input.orderNumber} is visible to you.`);
    if (["delivered", "cancelled"].includes(order.status)) {
      throw new AppError("invalid", `Order ${input.orderNumber} is ${order.status} and can no longer be discounted.`);
    }
    return {
      preview: {
        title: `Request ${input.discountPct}% discount`,
        summary: `Sends a discount request on ${input.orderNumber} to the owner for approval.`,
        changes: [
          { entity: "Approval request", label: input.orderNumber, field: "discount", from: null, to: `${input.discountPct}%` },
          { entity: "Approval request", label: input.orderNumber, field: "status", from: null, to: "pending" },
        ],
      },
      apply: async () => {
        const [created] = await db
          .insert(approvalRequests)
          .values({
            tenantId: scope.tenantId,
            kind: "discount",
            status: "pending",
            requestedBy: scope.userId,
            customerId: order.customerId,
            orderId: order.id,
            payload: { discountPct: input.discountPct },
            reason: input.reason,
          })
          .returning({ id: approvalRequests.id });
        return { requestId: created!.id, status: "pending" };
      },
    };
  },
});

export const createQuote = defineAction({
  name: "createQuote",
  description: "Create a draft quote for a customer at current list prices.",
  permission: "quotes:create",
  input: z.object({
    customerCode: z.string().min(1),
    lines: z.array(z.object({ sku: z.string().min(1), qty: z.number().int().min(1).max(10_000) })).min(1).max(20),
  }),
  async prepare({ db, scope }, input) {
    const [customer] = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.code, input.customerCode));
    if (!customer) throw new AppError("not_found", `No customer ${input.customerCode} is visible to you.`);
    const skus = input.lines.map((l) => l.sku);
    const found = await db
      .select({ id: products.id, sku: products.sku, name: products.name, priceCents: products.priceCents })
      .from(products)
      .where(inArray(products.sku, skus));
    const bySku = new Map(found.map((p) => [p.sku, p]));
    const missing = skus.filter((s) => !bySku.has(s));
    if (missing.length) throw new AppError("not_found", `Unknown SKU: ${missing.join(", ")}.`);
    const lines = input.lines.map((l) => {
      const p = bySku.get(l.sku)!;
      return { productId: p.id, sku: p.sku, name: p.name, qty: l.qty, unitPriceCents: p.priceCents };
    });
    const total = lines.reduce((a, l) => a + l.qty * l.unitPriceCents, 0);
    const changes: Change[] = lines.map((l) => ({
      entity: "Quote line",
      label: l.sku,
      field: `${l.qty} x ${money(l.unitPriceCents)}`,
      from: null,
      to: money(l.qty * l.unitPriceCents),
    }));
    return {
      preview: {
        title: `Quote for ${customer.name}`,
        summary: `Creates a draft quote with ${lines.length} line${lines.length === 1 ? "" : "s"}, total ${money(total)}.`,
        changes,
      },
      apply: async () => {
        const number = `Q-${randomBytes(3).toString("hex").toUpperCase()}`;
        await db.insert(quotes).values({
          tenantId: scope.tenantId,
          number,
          customerId: customer.id,
          createdBy: scope.userId,
          status: "draft",
          lines,
        });
        return { number, totalCents: total };
      },
    };
  },
});

export const decideApproval = defineAction({
  name: "decideApproval",
  description: "Approve or reject a pending request. Approving applies its effect.",
  permission: "approvals:decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject"]), reason }),
  async prepare({ db, scope, now }, input) {
    const [req] = await db
      .select({
        id: approvalRequests.id,
        kind: approvalRequests.kind,
        status: approvalRequests.status,
        requestedBy: approvalRequests.requestedBy,
        customerId: approvalRequests.customerId,
        orderId: approvalRequests.orderId,
        payload: approvalRequests.payload,
      })
      .from(approvalRequests)
      .where(eq(approvalRequests.id, input.requestId))
      .for("update");
    if (!req) throw new AppError("not_found", "That request is not visible to you.");
    if (req.status !== "pending") throw new AppError("invalid", `That request is already ${req.status}.`);
    if (req.requestedBy === scope.userId) throw new AppError("invalid", "You cannot decide your own request.");

    const status = input.decision === "approve" ? "approved" : "rejected";
    const changes: Change[] = [{ entity: "Request", label: req.kind.replace("_", " "), field: "status", from: "pending", to: status }];
    let effect: () => Promise<void> = async () => {};
    const payload = req.payload as Record<string, number | string>;

    if (input.decision === "approve" && req.kind === "credit_override") {
      const [c] = await db
        .select({ name: customers.name, limit: customers.creditLimitCents })
        .from(customers)
        .where(eq(customers.id, req.customerId!));
      const to = Number(payload.requestedLimitCents);
      changes.push({ entity: "Customer", label: c!.name, field: "credit limit", from: money(c!.limit), to: money(to) });
      effect = async () => {
        await db.update(customers).set({ creditLimitCents: to }).where(eq(customers.id, req.customerId!));
      };
    } else if (input.decision === "approve" && req.kind === "discount") {
      const [o] = await db
        .select({ number: salesOrders.number, pct: sql<number>`max(${salesOrderLines.discountPct})` })
        .from(salesOrders)
        .innerJoin(salesOrderLines, eq(salesOrderLines.orderId, salesOrders.id))
        .where(eq(salesOrders.id, req.orderId!))
        .groupBy(salesOrders.number);
      const to = Number(payload.discountPct);
      changes.push({ entity: "Order", label: o!.number, field: "discount", from: `${o!.pct}%`, to: `${to}%` });
      effect = async () => {
        await db.update(salesOrderLines).set({ discountPct: to }).where(eq(salesOrderLines.orderId, req.orderId!));
      };
    } else if (input.decision === "approve" && req.kind === "price_change") {
      const [p] = await db
        .select({ sku: products.sku, price: products.priceCents })
        .from(products)
        .where(eq(products.id, String(payload.productId)));
      const to = Number(payload.toCents);
      changes.push({ entity: "Product", label: p!.sku, field: "price", from: money(p!.price), to: money(to) });
      effect = async () => {
        await db.update(products).set({ priceCents: to }).where(eq(products.id, String(payload.productId)));
      };
    }

    return {
      preview: {
        title: `${input.decision === "approve" ? "Approve" : "Reject"} ${req.kind.replace("_", " ")} request`,
        summary: `Reason: ${input.reason}`,
        changes,
      },
      apply: async () => {
        await effect();
        await db
          .update(approvalRequests)
          .set({ status, decidedBy: scope.userId, decidedAt: now, decisionReason: input.reason })
          .where(eq(approvalRequests.id, req.id));
        return { requestId: req.id, status };
      },
    };
  },
});

export const adjustPrice = defineAction({
  name: "adjustPrice",
  description: "Change a product's selling price.",
  permission: "prices:adjust",
  input: z.object({ sku: z.string().min(1), priceCents: z.number().int().min(1).max(10_000_000), reason }),
  async prepare({ db }, input) {
    const [p] = await db
      .select({ id: products.id, name: products.name, price: products.priceCents })
      .from(products)
      .where(eq(products.sku, input.sku));
    if (!p) throw new AppError("not_found", `No product ${input.sku}.`);
    if (p.price === input.priceCents) throw new AppError("invalid", `${input.sku} already costs ${money(p.price)}.`);
    return {
      preview: {
        title: `Change price of ${input.sku}`,
        summary: `${p.name}. Reason: ${input.reason}`,
        changes: [{ entity: "Product", label: input.sku, field: "price", from: money(p.price), to: money(input.priceCents) }],
      },
      apply: async () => {
        await db.update(products).set({ priceCents: input.priceCents }).where(eq(products.id, p.id));
        return { sku: input.sku, priceCents: input.priceCents };
      },
    };
  },
});

export const recordPayment = defineAction({
  name: "recordPayment",
  description: "Record a customer payment against an open invoice.",
  permission: "payments:record",
  input: z.object({
    invoiceNumber: z.string().min(1),
    amountCents: z.number().int().min(1),
    method: z.enum(["bank_transfer", "card", "cheque"]),
    reference: z.string().trim().min(2).max(60),
  }),
  async prepare({ db, scope, now }, input) {
    const [inv] = await db
      .select({ id: invoices.id, customerId: invoices.customerId, total: invoices.totalCents, paid: invoices.paidCents, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.number, input.invoiceNumber))
      .for("update");
    if (!inv) throw new AppError("not_found", `No invoice ${input.invoiceNumber} is visible to you.`);
    const outstanding = inv.total - inv.paid;
    if (input.amountCents > outstanding) {
      throw new AppError("invalid", `Only ${money(outstanding)} is outstanding on ${input.invoiceNumber}.`);
    }
    const paid = inv.paid + input.amountCents;
    const status = paid === inv.total ? "paid" : "partial";
    return {
      preview: {
        title: `Record payment on ${input.invoiceNumber}`,
        summary: `${money(input.amountCents)} by ${input.method.replace("_", " ")}, reference ${input.reference}.`,
        changes: [
          { entity: "Invoice", label: input.invoiceNumber, field: "paid", from: money(inv.paid), to: money(paid) },
          { entity: "Invoice", label: input.invoiceNumber, field: "status", from: inv.status, to: status },
          { entity: "Ledger", label: input.reference, field: "credit", from: null, to: money(input.amountCents) },
        ],
      },
      apply: async () => {
        await db.insert(payments).values({
          tenantId: scope.tenantId,
          customerId: inv.customerId,
          invoiceId: inv.id,
          amountCents: input.amountCents,
          receivedAt: now,
          method: input.method,
          reference: input.reference,
        });
        await db.insert(ledgerEntries).values({
          tenantId: scope.tenantId,
          customerId: inv.customerId,
          at: now,
          kind: "payment",
          reference: input.reference,
          debitCents: 0,
          creditCents: input.amountCents,
        });
        await db.update(invoices).set({ paidCents: paid, status }).where(eq(invoices.id, inv.id));
        return { invoiceNumber: input.invoiceNumber, paidCents: paid, status };
      },
    };
  },
});
