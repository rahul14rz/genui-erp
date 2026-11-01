import * as s from "../src/schema.ts";
import { createRng, type Rng } from "./rng.ts";
import { TENANTS, type TenantConfig } from "./tenants.ts";

export const SEED = 20260101;
export const LOCAL_PASSWORD = "genui-erp-local";
const DAYS = 182;
const DAY = 86_400_000;

type Row<T extends { $inferInsert: unknown }> = Required<T["$inferInsert"]>;

export type Dataset = {
  tenants: Row<typeof s.tenants>[];
  users: (Omit<Row<typeof s.users>, "passwordHash"> & { passwordSalt: Buffer })[];
  customers: Row<typeof s.customers>[];
  products: Row<typeof s.products>[];
  warehouses: Row<typeof s.warehouses>[];
  stockLevels: Row<typeof s.stockLevels>[];
  salesOrders: Row<typeof s.salesOrders>[];
  salesOrderLines: Row<typeof s.salesOrderLines>[];
  quotes: Row<typeof s.quotes>[];
  purchaseOrders: Row<typeof s.purchaseOrders>[];
  purchaseOrderLines: Row<typeof s.purchaseOrderLines>[];
  dispatches: Row<typeof s.dispatches>[];
  dispatchEvents: Row<typeof s.dispatchEvents>[];
  invoices: Row<typeof s.invoices>[];
  payments: Row<typeof s.payments>[];
  ledgerEntries: Row<typeof s.ledgerEntries>[];
  approvalRequests: Row<typeof s.approvalRequests>[];
};

export const emptyDataset = (): Dataset => ({
  tenants: [],
  users: [],
  customers: [],
  products: [],
  warehouses: [],
  stockLevels: [],
  salesOrders: [],
  salesOrderLines: [],
  quotes: [],
  purchaseOrders: [],
  purchaseOrderLines: [],
  dispatches: [],
  dispatchEvents: [],
  invoices: [],
  payments: [],
  ledgerEntries: [],
  approvalRequests: [],
});

/** Midnight UTC of the given date. Every seeded timestamp is relative to it. */
export function anchorOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const addHours = (d: Date, n: number) => new Date(d.getTime() + n * 3_600_000);

export function generate(anchor: Date): Dataset {
  const rng = createRng(SEED);
  const out = emptyDataset();
  for (const cfg of TENANTS) generateTenant(rng, cfg, anchorOf(anchor), out);
  return out;
}

function generateTenant(rng: Rng, cfg: TenantConfig, anchor: Date, out: Dataset) {
  const tenantId = rng.uuid();
  const start = addDays(anchor, -DAYS);
  out.tenants.push({ id: tenantId, slug: cfg.slug, name: cfg.name, currency: cfg.currency });

  const userIds = {} as Record<s.Role, string>;
  for (const role of s.ROLES) {
    userIds[role] = rng.uuid();
    out.users.push({
      id: userIds[role],
      tenantId,
      email: `${role.replace("_", "")}@${cfg.emailDomain}`,
      name: cfg.people[role],
      role,
      passwordSalt: rng.bytes(16),
    });
  }

  const warehouses = cfg.warehouses.map((w) => ({ id: rng.uuid(), tenantId, ...w }));
  out.warehouses.push(...warehouses);

  const products: Row<typeof s.products>[] = [];
  for (const cat of cfg.categories) {
    cat.items.forEach((item, i) => {
      const base = rng.int(cat.priceRange[0], cat.priceRange[1]);
      for (const variant of cat.variants) {
        const price = Math.round((base * (1 + rng.next() * 0.1)) / 5) * 5;
        products.push({
          id: rng.uuid(),
          tenantId,
          sku: `${cat.prefix}-${String(i + 1).padStart(2, "0")}-${variant.toUpperCase().replace(/[^A-Z0-9]/g, "")}`,
          name: `${item}, ${variant}`,
          category: cat.name,
          unit: cat.unit,
          priceCents: price,
          costCents: Math.round(price * (0.52 + rng.next() * 0.22)),
        });
      }
    });
  }
  out.products.push(...products);

  // Two products are out of stock everywhere and a few more are below their
  // reorder point, so "what is running low" has real answers.
  const stockOuts = new Set([products[3]!.id, products[products.length - 5]!.id]);
  const lowStock = new Set([products[10]!.id, products[22]!.id, products[37]!.id]);
  for (const p of products) {
    for (const w of warehouses) {
      const reorderPoint = rng.int(20, 60);
      const onHand = stockOuts.has(p.id)
        ? 0
        : lowStock.has(p.id)
          ? rng.int(1, reorderPoint - 5)
          : rng.int(reorderPoint, reorderPoint * 6);
      out.stockLevels.push({
        tenantId,
        productId: p.id,
        warehouseId: w.id,
        onHand,
        reserved: stockOuts.has(p.id) ? 0 : rng.int(0, Math.floor(onHand / 4)),
        reorderPoint,
      });
    }
  }

  const customers: Row<typeof s.customers>[] = [];
  const names = new Set<string>();
  while (customers.length < 40) {
    const name = `${rng.pick(cfg.customerPrefixes)} ${rng.pick(cfg.customerSuffixes)}`;
    if (names.has(name)) continue;
    names.add(name);
    const n = customers.length;
    customers.push({
      id: rng.uuid(),
      tenantId,
      code: `C${String(1001 + n)}`,
      name,
      city: rng.pick(cfg.cities),
      // Half the book belongs to the sales rep, the rest are house accounts.
      ownerUserId: n % 2 === 0 ? userIds.sales_rep : userIds.owner,
      creditLimitCents: rng.pick([500_000, 1_000_000, 2_500_000, 5_000_000]),
      notes: n === 4 || n === 9 ? cfg.injectionNotes[n === 4 ? 0 : 1]! : rng.chance(0.3) ? rng.pick(NOTES) : null,
      createdAt: addDays(start, -rng.int(30, 900)),
    });
  }
  out.customers.push(...customers);
  // A few large accounts carry most of the volume.
  const customerWeights = customers.map((_, i) => (i < 6 ? 8 : i < 16 ? 3 : 1));

  let orderSeq = 10001;
  let invoiceSeq = 50001;
  let paymentSeq = 1;
  const stuckSlots = new Set([5, 6, 8, 11]);
  for (let day = 0; day <= DAYS; day++) {
    const date = addDays(start, day);
    const age = DAYS - day;
    const weekday = date.getUTCDay();
    const weekdayFactor = weekday === 0 ? 0.15 : weekday === 6 ? 0.45 : 1.1;
    const expected = cfg.ordersPerDay * cfg.seasonality[date.getUTCMonth()]! * weekdayFactor;
    const count = Math.max(0, Math.round(expected + (rng.next() - 0.5) * expected * 0.6));
    for (let k = 0; k < count; k++) {
      const customer = rng.weighted(customers, customerWeights);
      const orderedAt = addHours(date, rng.int(7, 18));
      const orderId = rng.uuid();
      const stuck = stuckSlots.has(age) && k === 0;
      const status: Row<typeof s.salesOrders>["status"] = stuck
        ? rng.pick(["picking", "packed"] as const)
        : rng.chance(0.03)
          ? "cancelled"
          : age > 9
            ? "delivered"
            : age > 4
              ? rng.pick(["dispatched", "delivered"] as const)
              : age > 1
                ? rng.pick(["picking", "packed", "dispatched"] as const)
                : rng.pick(["confirmed", "picking"] as const);
      const injected = customer.notes !== null && cfg.injectionNotes.includes(customer.notes) && rng.chance(0.15);
      out.salesOrders.push({
        id: orderId,
        tenantId,
        number: `SO-${orderSeq++}`,
        customerId: customer.id,
        status,
        orderedAt,
        requiredBy: isoDate(addDays(date, rng.int(3, 14))),
        notes: injected ? cfg.injectionOrderNote : rng.chance(0.1) ? rng.pick(ORDER_NOTES) : null,
      });

      let total = 0;
      const lineCount = rng.int(1, 5);
      for (let l = 0; l < lineCount; l++) {
        const p = rng.pick(products);
        const qty = p.unit === "m" ? rng.int(20, 200) : rng.int(2, 40);
        const discountPct = rng.weighted([0, 5, 10], [6, 3, 1]);
        total += Math.round(qty * p.priceCents * (1 - discountPct / 100));
        out.salesOrderLines.push({
          id: rng.uuid(),
          tenantId,
          orderId,
          productId: p.id,
          qty,
          unitPriceCents: p.priceCents,
          unitCostCents: p.costCents,
          discountPct,
        });
      }

      if (status === "cancelled" || status === "confirmed") continue;

      const warehouse = rng.pick(warehouses);
      const queuedAt = addHours(orderedAt, rng.int(1, 6));
      const dispatchStatus: Row<typeof s.dispatches>["status"] = status;
      const dispatchedAt =
        status === "dispatched" || status === "delivered"
          ? addHours(queuedAt, rng.int(12, 60))
          : null;
      const dispatchId = rng.uuid();
      out.dispatches.push({
        id: dispatchId,
        tenantId,
        orderId,
        warehouseId: warehouse.id,
        status: dispatchStatus,
        queuedAt,
        dispatchedAt,
        carrier: dispatchedAt ? rng.pick(cfg.carriers) : null,
      });
      const timeline: Row<typeof s.dispatches>["status"][] = ["queued", "picking", "packed", "dispatched", "delivered"];
      const reached = timeline.indexOf(dispatchStatus);
      let eventAt = queuedAt;
      for (let i = 0; i <= reached; i++) {
        out.dispatchEvents.push({
          id: rng.uuid(),
          tenantId,
          dispatchId,
          status: timeline[i]!,
          at: eventAt,
          note: stuck && i === reached ? rng.pick(STUCK_NOTES) : null,
        });
        eventAt = timeline[i + 1] === "dispatched" && dispatchedAt ? dispatchedAt : addHours(eventAt, rng.int(3, 20));
      }

      if (!dispatchedAt) continue;

      const invoiceId = rng.uuid();
      const dueAt = addDays(dispatchedAt, 30);
      const invoiceNumber = `INV-${invoiceSeq++}`;
      // Two slow-paying accounts stopped paying about ten weeks ago. Everyone
      // else pays on time, with the odd payment a week or so late.
      const slowPayer = SLOW_PAYERS.includes(customers.indexOf(customer)) && age < 70;
      const payDays = rng.chance(0.9) ? rng.int(10, 28) : rng.int(31, 38);
      const paidAt = addDays(dispatchedAt, payDays);
      const willPay = !slowPayer;
      const partial = willPay && rng.chance(0.015);
      const paid = willPay && paidAt.getTime() <= anchor.getTime() ? (partial ? Math.round(total * 0.5) : total) : 0;
      out.invoices.push({
        id: invoiceId,
        tenantId,
        number: invoiceNumber,
        customerId: customer.id,
        orderId,
        issuedAt: dispatchedAt,
        dueAt: isoDate(dueAt),
        totalCents: total,
        paidCents: paid,
        status: paid === 0 ? "open" : paid < total ? "partial" : "paid",
      });
      out.ledgerEntries.push({
        id: rng.uuid(),
        tenantId,
        customerId: customer.id,
        at: dispatchedAt,
        kind: "invoice",
        reference: invoiceNumber,
        debitCents: total,
        creditCents: 0,
      });
      if (paid > 0) {
        const reference = `PAY-${String(paymentSeq++).padStart(5, "0")}`;
        out.payments.push({
          id: rng.uuid(),
          tenantId,
          customerId: customer.id,
          invoiceId,
          amountCents: paid,
          receivedAt: paidAt,
          method: rng.pick(["bank_transfer", "bank_transfer", "card", "cheque"]),
          reference,
        });
        out.ledgerEntries.push({
          id: rng.uuid(),
          tenantId,
          customerId: customer.id,
          at: paidAt,
          kind: "payment",
          reference,
          debitCents: 0,
          creditCents: paid,
        });
      }
    }
  }

  let poSeq = 3001;
  for (let i = 0; i < 30; i++) {
    const orderedAt = addDays(start, rng.int(0, DAYS));
    const age = (anchor.getTime() - orderedAt.getTime()) / DAY;
    const poId = rng.uuid();
    const status = age > 30 ? "received" : age > 14 ? rng.pick(["received", "partial"] as const) : "open";
    out.purchaseOrders.push({
      id: poId,
      tenantId,
      number: `PO-${poSeq++}`,
      supplierName: rng.pick(cfg.suppliers),
      warehouseId: rng.pick(warehouses).id,
      status,
      orderedAt,
      expectedAt: isoDate(addDays(orderedAt, rng.int(10, 28))),
    });
    for (let l = rng.int(2, 6); l > 0; l--) {
      const p = rng.pick(products);
      const qty = rng.int(50, 400);
      out.purchaseOrderLines.push({
        id: rng.uuid(),
        tenantId,
        purchaseOrderId: poId,
        productId: p.id,
        qty,
        receivedQty: status === "received" ? qty : status === "partial" ? Math.floor(qty / 2) : 0,
        unitCostCents: p.costCents,
      });
    }
  }

  const recentRepOrders = out.salesOrders.filter(
    (o) =>
      o.tenantId === tenantId &&
      o.status === "confirmed" &&
      customers.find((c) => c.id === o.customerId)?.ownerUserId === userIds.sales_rep,
  );
  for (const order of recentRepOrders.slice(0, 3)) {
    out.approvalRequests.push({
      id: rng.uuid(),
      tenantId,
      kind: "discount",
      status: "pending",
      requestedBy: userIds.sales_rep,
      customerId: order.customerId,
      orderId: order.id,
      payload: { discountPct: rng.pick([12, 15, 20]) },
      reason: rng.pick(DISCOUNT_REASONS),
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      createdAt: addHours(order.orderedAt, 2),
    });
  }
  for (const c of customers.slice(0, 2)) {
    out.approvalRequests.push({
      id: rng.uuid(),
      tenantId,
      kind: "credit_override",
      status: "pending",
      requestedBy: userIds.sales_rep,
      customerId: c.id,
      orderId: null,
      payload: { currentLimitCents: c.creditLimitCents, requestedLimitCents: c.creditLimitCents * 2 },
      reason: "Seasonal stock-up order exceeds the current limit.",
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      createdAt: addDays(anchor, -rng.int(1, 4)),
    });
  }
  const priced = products[7]!;
  out.approvalRequests.push({
    id: rng.uuid(),
    tenantId,
    kind: "price_change",
    status: "approved",
    requestedBy: userIds.sales_rep,
    customerId: null,
    orderId: null,
    payload: { productId: priced.id, fromCents: priced.priceCents, toCents: priced.priceCents },
    reason: "Match the regional distributor price.",
    decidedBy: userIds.owner,
    decidedAt: addDays(anchor, -20),
    decisionReason: "Agreed for the quarter.",
    createdAt: addDays(anchor, -22),
  });

  const repCustomers = customers.filter((c) => c.ownerUserId === userIds.sales_rep);
  for (let i = 0; i < 4; i++) {
    const p = rng.pick(products);
    out.quotes.push({
      id: rng.uuid(),
      tenantId,
      number: `Q-${7001 + i}`,
      customerId: rng.pick(repCustomers).id,
      createdBy: userIds.sales_rep,
      status: rng.pick(["draft", "sent", "accepted", "expired"] as const),
      lines: [{ productId: p.id, sku: p.sku, qty: rng.int(5, 50), unitPriceCents: p.priceCents }],
      createdAt: addDays(anchor, -rng.int(1, 40)),
    });
  }
}

const SLOW_PAYERS = [12, 21];

const NOTES = [
  "Deliveries to the rear loading bay only.",
  "Prefers invoices by post.",
  "Account reviewed in March. No change.",
  "Call before dispatching orders over 200 units.",
  "Closed on Mondays.",
];
const ORDER_NOTES = ["Urgent, customer event this week.", "Split delivery allowed.", "Pack in labelled cartons."];
const STUCK_NOTES = [
  "Waiting on short stock from another warehouse.",
  "Carrier missed collection.",
  "Address check pending with customer.",
];
const DISCOUNT_REASONS = [
  "Competing quote from another wholesaler.",
  "Volume order, first of the season.",
  "Customer is consolidating suppliers.",
];
