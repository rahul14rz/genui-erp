import { customers, invoices, ledgerEntries, users } from "@genui-erp/db";
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { defineTool, filtersOf, isoDate, page } from "./types.ts";

export const listCustomers = defineTool({
  name: "listCustomers",
  description:
    "Customers visible to the user, with city and account owner. Credit limits appear only for roles that can see them. Search matches name or code.",
  permission: "customers:read",
  input: z.object({ search: z.string().max(40).optional(), ...page }),
  output: z.strictObject({
    total: z.number(),
    rows: z.array(
      z.strictObject({
        code: z.string(),
        name: z.string(),
        city: z.string(),
        creditLimitCents: z.number().optional(),
      }),
    ),
  }),
  async run({ db, can }, input) {
    const showCredit = can("credit:read");
    const rows = await db
      .select({
        code: customers.code,
        name: customers.name,
        city: customers.city,
        ...(showCredit ? { creditLimitCents: customers.creditLimitCents } : {}),
        total: sql<number>`count(*) over ()::int`,
      })
      .from(customers)
      .where(input.search ? or(ilike(customers.name, `%${input.search}%`), ilike(customers.code, `%${input.search}%`)) : undefined)
      .orderBy(asc(customers.code))
      .limit(input.limit)
      .offset(input.offset);
    return {
      data: { total: rows[0]?.total ?? 0, rows: rows.map(({ total: _t, ...r }) => r) },
      source: { tables: ["customers"], filters: filtersOf(input) },
    };
  },
});

export const getCustomer = defineTool({
  name: "getCustomer",
  description:
    "One customer's record by code: city, account owner, notes, credit limit and outstanding balance where the role allows.",
  permission: "customers:read",
  input: z.object({ code: z.string().min(1) }),
  output: z.strictObject({
    code: z.string(),
    name: z.string(),
    city: z.string(),
    accountOwner: z.string().optional(),
    notes: z.string().nullable().optional(),
    creditLimitCents: z.number().optional(),
    balanceCents: z.number().optional(),
  }),
  async run({ db, can }, input) {
    // Warehouse staff have no grant on notes or the account owner column, so
    // those columns are left out of the query entirely for them.
    const showNotes = can("customers:notes");
    const showCredit = can("credit:read");
    const [c] = showNotes
      ? await db
          .select({
            id: customers.id,
            code: customers.code,
            name: customers.name,
            city: customers.city,
            accountOwner: users.name,
            notes: customers.notes,
            ...(showCredit ? { creditLimitCents: customers.creditLimitCents } : {}),
          })
          .from(customers)
          .innerJoin(users, eq(users.id, customers.ownerUserId))
          .where(eq(customers.code, input.code))
      : await db
          .select({ id: customers.id, code: customers.code, name: customers.name, city: customers.city })
          .from(customers)
          .where(eq(customers.code, input.code));
    if (!c) throw new AppError("not_found", `No customer ${input.code} is visible to you.`);
    const { id, ...rest } = c;
    let balanceCents: number | undefined;
    if (can("finance:read")) {
      const [b] = await db
        .select({ v: sql<number>`coalesce(sum(${ledgerEntries.debitCents} - ${ledgerEntries.creditCents}), 0)::bigint` })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.customerId, id));
      balanceCents = b?.v ?? 0;
    }
    return {
      data: { ...rest, ...(balanceCents !== undefined ? { balanceCents } : {}) },
      source: { tables: ["customers", ...(balanceCents !== undefined ? ["ledger_entries"] : [])], filters: { code: input.code } },
    };
  },
});

export const getCustomerLedger = defineTool({
  name: "getCustomerLedger",
  description: "A customer's ledger: invoices and payments in date order with a running balance.",
  permission: "finance:read",
  input: z.object({ customerCode: z.string().min(1), from: isoDate.optional(), to: isoDate.optional() }),
  output: z.strictObject({
    customer: z.strictObject({ code: z.string(), name: z.string(), creditLimitCents: z.number(), balanceCents: z.number() }),
    entries: z.array(
      z.strictObject({
        at: z.string(),
        kind: z.enum(["invoice", "payment", "credit_note", "adjustment"]),
        reference: z.string(),
        debitCents: z.number(),
        creditCents: z.number(),
        balanceCents: z.number(),
      }),
    ),
  }),
  async run({ db }, input) {
    const [c] = await db
      .select({ id: customers.id, code: customers.code, name: customers.name, creditLimitCents: customers.creditLimitCents })
      .from(customers)
      .where(eq(customers.code, input.customerCode));
    if (!c) throw new AppError("not_found", `No customer ${input.customerCode} is visible to you.`);
    const rows = await db
      .select({
        at: ledgerEntries.at,
        kind: ledgerEntries.kind,
        reference: ledgerEntries.reference,
        debitCents: ledgerEntries.debitCents,
        creditCents: ledgerEntries.creditCents,
        balanceCents: sql<number>`sum(${ledgerEntries.debitCents} - ${ledgerEntries.creditCents}) over (order by ${ledgerEntries.at}, ${ledgerEntries.reference})::bigint`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.customerId, c.id))
      .orderBy(asc(ledgerEntries.at), asc(ledgerEntries.reference));
    const inRange = rows.filter((r) => {
      const d = r.at.toISOString().slice(0, 10);
      return (!input.from || d >= input.from) && (!input.to || d <= input.to);
    });
    const { id: _id, ...customer } = c;
    return {
      data: {
        customer: { ...customer, balanceCents: rows.at(-1)?.balanceCents ?? 0 },
        entries: inRange.map((r) => ({ ...r, at: r.at.toISOString() })),
      },
      source: { tables: ["customers", "ledger_entries"], filters: filtersOf(input) },
    };
  },
});

const INVOICE_STATUS = ["open", "partial", "paid", "void"] as const;

export const listInvoices = defineTool({
  name: "listInvoices",
  description:
    "Invoices with amounts paid and outstanding. Set overdue to true for unpaid invoices past their due date, sorted by most days overdue.",
  permission: "finance:read",
  input: z.object({
    status: z.array(z.enum(INVOICE_STATUS)).optional(),
    overdue: z.boolean().optional(),
    customerCode: z.string().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    ...page,
  }),
  output: z.strictObject({
    total: z.number(),
    outstandingCents: z.number(),
    rows: z.array(
      z.strictObject({
        number: z.string(),
        customer: z.string(),
        customerCode: z.string(),
        issuedAt: z.string(),
        dueAt: z.string(),
        totalCents: z.number(),
        paidCents: z.number(),
        outstandingCents: z.number(),
        status: z.enum(INVOICE_STATUS),
        daysOverdue: z.number(),
      }),
    ),
  }),
  async run({ db, now }, input) {
    const today = now.toISOString().slice(0, 10);
    const where: SQL[] = [];
    if (input.status?.length) where.push(inArray(invoices.status, input.status));
    if (input.overdue) where.push(inArray(invoices.status, ["open", "partial"]), lt(invoices.dueAt, today));
    if (input.customerCode) where.push(eq(customers.code, input.customerCode));
    if (input.from) where.push(gte(invoices.issuedAt, new Date(`${input.from}T00:00:00Z`)));
    if (input.to) where.push(lte(invoices.issuedAt, new Date(`${input.to}T23:59:59Z`)));
    const rows = await db
      .select({
        number: invoices.number,
        customer: customers.name,
        customerCode: customers.code,
        issuedAt: invoices.issuedAt,
        dueAt: invoices.dueAt,
        totalCents: invoices.totalCents,
        paidCents: invoices.paidCents,
        status: invoices.status,
        total: sql<number>`count(*) over ()::int`,
        outstandingAll: sql<number>`sum(${invoices.totalCents} - ${invoices.paidCents}) over ()::bigint`,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(and(...where))
      .orderBy(input.overdue ? asc(invoices.dueAt) : desc(invoices.issuedAt), asc(invoices.number))
      .limit(input.limit)
      .offset(input.offset);
    return {
      data: {
        total: rows[0]?.total ?? 0,
        outstandingCents: rows[0]?.outstandingAll ?? 0,
        rows: rows.map(({ total: _t, outstandingAll: _o, ...r }) => ({
          ...r,
          issuedAt: r.issuedAt.toISOString(),
          outstandingCents: r.totalCents - r.paidCents,
          daysOverdue:
            r.status === "paid" || r.dueAt >= today
              ? 0
              : Math.floor((now.getTime() - new Date(`${r.dueAt}T00:00:00Z`).getTime()) / 86_400_000),
        })),
      },
      source: { tables: ["invoices", "customers"], filters: filtersOf(input) },
    };
  },
});
