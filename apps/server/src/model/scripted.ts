import { randomUUID } from "node:crypto";
import type { ChatMessage, Completion, CompletionRequest, ModelAdapter, ToolCall } from "./types.ts";

type C = Record<string, unknown> & { id: string; component: string };
type Plan = {
  tool: string;
  args: Record<string, unknown>;
  layout: (r: string, has: (component: string) => boolean, data: Record<string, unknown> | null) => { say: string; components: C[] };
};

const panel = (title: string, children: string[], followUps: string[], subtitle?: string): C => ({
  id: "root",
  component: "Panel",
  title,
  ...(subtitle ? { subtitle } : {}),
  children,
  followUps,
});

const table = (id: string, r: string, title: string, columns: [string, string, string][], extra: Record<string, unknown> = {}): C => ({
  id,
  component: "DataTable",
  title,
  columns: columns.map(([key, label, type]) => ({ key, label, type })),
  rows: { bind: `${r}.rows` },
  total: { bind: `${r}.total` },
  ...extra,
});

const refusal = (title: string, body: string, nextStep: string) => ({
  say: body,
  components: [panel(title, ["n"], []), { id: "n", component: "Notice", tone: "warning", title, body, nextStep }],
});

const orderNumber = (q: string) => q.match(/\b(SO-\d{5})\b/i)?.[1]?.toUpperCase();
const customerCode = (q: string) => q.match(/\b([NC]\d{4})\b/)?.[1];

/** The last three complete calendar months, so totals have a full previous period to compare with. */
function lastFullMonths(today: string, months = 3) {
  const d = new Date(`${today}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** Keyword plans covering the questions the demo and the evals ask. */
function plan(q: string, today: string): Plan | null {
  const window = lastFullMonths(today);
  const s = q.toLowerCase();
  const order = orderNumber(q);
  if (order) {
    return {
      tool: "getOrder",
      args: { number: order },
      layout: (r, has) => ({
        say: `Here is ${order}.`,
        components: [
          panel(order, ["card", ...(has("Timeline") ? ["tl"] : [])], ["Show other orders for this customer", "Which orders are stuck in dispatch?"]),
          {
            id: "card",
            component: "RecordCard",
            title: { bind: `${r}.number` },
            subtitle: { bind: `${r}.customer.name` },
            status: { bind: `${r}.status` },
            fields: [
              { label: "Ordered", value: { bind: `${r}.orderedAt` }, type: "date" },
              { label: "Required by", value: { bind: `${r}.requiredBy` }, type: "date" },
              { label: "City", value: { bind: `${r}.customer.city` }, type: "text" },
              { label: "Customer code", value: { bind: `${r}.customer.code` }, type: "mono" },
            ],
          },
          ...(has("Timeline")
            ? [{ id: "tl", component: "Timeline", title: "Status history", rows: { bind: `${r}.timeline` }, labelField: "status", atField: "at", noteField: "note" }]
            : []),
        ],
      }),
    };
  }
  if (/margin|profit|cost/.test(s)) {
    return {
      tool: "getMargins",
      args: { groupBy: s.includes("product") ? "product" : s.includes("customer") ? "customer" : "category", ...window },
      layout: (r) => ({
        say: "Gross margin for the last three full months.",
        components: [
          panel("Gross margin", ["k", "b", "t"], ["Which products have the lowest margin?", "Show margin by customer"]),
          {
            id: "k",
            component: "KpiStrip",
            items: [
              { label: "Revenue", value: { bind: `${r}.totals.revenueCents` }, format: "money" },
              { label: "Gross margin", value: { bind: `${r}.totals.marginCents` }, format: "money" },
              { label: "Margin", value: { bind: `${r}.totals.marginPct` }, format: "percent" },
            ],
          },
          { id: "b", component: "BreakdownBar", title: "Margin by group", rows: { bind: `${r}.rows` }, labelField: "label", valueField: "marginCents", format: "money" },
          {
            id: "t",
            component: "DataTable",
            columns: [
              { key: "label", label: "Group", type: "text" },
              { key: "revenueCents", label: "Revenue", type: "money" },
              { key: "costCents", label: "Cost", type: "money" },
              { key: "marginPct", label: "Margin", type: "percent" },
            ],
            rows: { bind: `${r}.rows` },
          },
        ],
      }),
    };
  }
  if (/stuck|dispatch|waiting to ship|not shipped/.test(s)) {
    return {
      tool: "getDispatchQueue",
      args: { olderThanDays: /stuck|week/.test(s) ? 3 : 0, limit: 25 },
      layout: (r, has) => ({
        say: "These orders are still waiting to leave a warehouse, oldest first.",
        components: [
          panel("Orders stuck in dispatch", ["t"], ["Which products are out of stock?", "Show open purchase orders"]),
          table(
            "t",
            r,
            "Waiting to dispatch",
            [
              ["orderNumber", "Order", "mono"],
              ["customer", "Customer", "text"],
              ["warehouse", "Warehouse", "text"],
              ["status", "Status", "status"],
              ["ageDays", "Days waiting", "number"],
              ["lastNote", "Last note", "text"],
            ],
            has("@markDispatched")
              ? {
                  rowActions: [
                    {
                      action: "markDispatched",
                      label: "Mark dispatched",
                      input: { orderNumber: { field: "orderNumber" } },
                      ask: [{ key: "carrier", label: "Carrier", kind: "text" }],
                    },
                  ],
                }
              : {},
          ),
        ],
      }),
    };
  }
  if (/stock|inventory|out of|running low|reorder/.test(s)) {
    return {
      tool: "getStockLevels",
      args: { belowReorder: /low|out|reorder|short/.test(s), limit: 25 },
      layout: (r) => ({
        say: "Stock lines at or below their reorder point, most urgent first.",
        components: [
          panel("Stock below reorder point", ["t"], ["Show open purchase orders", "Which orders are stuck in dispatch?"]),
          table("t", r, "Stock by warehouse", [
            ["sku", "SKU", "mono"],
            ["product", "Product", "text"],
            ["warehouse", "Warehouse", "text"],
            ["available", "Available", "number"],
            ["reorderPoint", "Reorder at", "number"],
            ["status", "Status", "status"],
          ]),
        ],
      }),
    };
  }
  if (/purchase order|supplier|restock|incoming/.test(s)) {
    return {
      tool: "listPurchaseOrders",
      args: { status: ["open", "partial"] },
      layout: (r) => ({
        say: "Open and partly received purchase orders.",
        components: [
          panel("Open purchase orders", ["t"], ["Which products are running low?"]),
          table("t", r, "Purchase orders", [
            ["number", "PO", "mono"],
            ["supplier", "Supplier", "text"],
            ["warehouse", "Warehouse", "text"],
            ["status", "Status", "status"],
            ["expectedAt", "Expected", "date"],
            ["receivedQty", "Received", "number"],
            ["qty", "Ordered", "number"],
          ]),
        ],
      }),
    };
  }
  if (/ledger|statement|balance/.test(s) && customerCode(q)) {
    const code = customerCode(q)!;
    return {
      tool: "getCustomerLedger",
      args: { customerCode: code },
      layout: (r) => ({
        say: `Ledger for ${code}.`,
        components: [
          panel(`Ledger for ${code}`, ["t"], ["Which invoices are overdue?"]),
          {
            id: "t",
            component: "DataTable",
            columns: [
              { key: "at", label: "Date", type: "date" },
              { key: "kind", label: "Type", type: "status" },
              { key: "reference", label: "Reference", type: "mono" },
              { key: "debitCents", label: "Debit", type: "money" },
              { key: "creditCents", label: "Credit", type: "money" },
              { key: "balanceCents", label: "Balance", type: "money" },
            ],
            rows: { bind: `${r}.entries` },
          },
        ],
      }),
    };
  }
  if (/overdue|invoice|receivable|owe|unpaid/.test(s)) {
    return {
      tool: "listInvoices",
      args: { overdue: true, limit: 25 },
      layout: (r, _has, data) => ({
        say: "Unpaid invoices past their due date, oldest first.",
        components: [
          panel("Overdue invoices", ["k", "t"], [
            ...(Array.isArray(data?.rows) && data.rows[0] ? [`Show the ledger for ${(data.rows[0] as { customerCode: string }).customerCode}`] : []),
            "Which credit requests are pending?",
          ]),
          {
            id: "k",
            component: "KpiStrip",
            items: [
              { label: "Outstanding", value: { bind: `${r}.outstandingCents` }, format: "money" },
              { label: "Invoices overdue", value: { bind: `${r}.total` }, format: "number" },
            ],
          },
          table("t", r, "Overdue", [
            ["number", "Invoice", "mono"],
            ["customer", "Customer", "text"],
            ["dueAt", "Due", "date"],
            ["daysOverdue", "Days overdue", "number"],
            ["outstandingCents", "Outstanding", "money"],
          ]),
        ],
      }),
    };
  }
  if (/approv|pending request|credit override|credit request|discount request/.test(s)) {
    return {
      tool: "listApprovals",
      args: { status: ["pending"] },
      layout: (r, has, data) => {
        const rows = (data?.rows as Record<string, unknown>[] | undefined) ?? [];
        const first = rows[0];
        if (first && has("ApprovalForm")) {
          const payload = (first.payload ?? {}) as Record<string, unknown>;
          const impact =
            first.kind === "credit_override"
              ? [
                  { label: "Current limit", value: { bind: `${r}.rows.0.payload.currentLimitCents` }, type: "money" },
                  { label: "Requested limit", value: { bind: `${r}.rows.0.payload.requestedLimitCents` }, type: "money" },
                ]
              : "discountPct" in payload
                ? [{ label: "Discount", value: { bind: `${r}.rows.0.payload.discountPct` }, type: "percent" }]
                : [];
          return {
            say: `${rows.length} request${rows.length === 1 ? " is" : "s are"} waiting for a decision.`,
            components: [
              panel("Pending approvals", ["f", "t"], ["Which invoices are overdue?"]),
              {
                id: "f",
                component: "ApprovalForm",
                requestId: { bind: `${r}.rows.0.id` },
                title: `Approve ${String(first.kind).replace("_", " ")}`,
                requestedBy: { bind: `${r}.rows.0.requestedBy` },
                reason: { bind: `${r}.rows.0.reason` },
                impact,
              },
              table("t", r, "All pending requests", [
                ["kind", "Type", "status"],
                ["customer", "Customer", "text"],
                ["requestedBy", "Requested by", "text"],
                ["createdAt", "Requested", "date"],
              ]),
            ],
          };
        }
        return {
          say: "Your pending requests.",
          components: [
            panel("Pending requests", ["t"], []),
            table("t", r, "Pending", [
              ["kind", "Type", "status"],
              ["customer", "Customer", "text"],
              ["reason", "Reason", "text"],
              ["createdAt", "Requested", "date"],
            ]),
          ],
        };
      },
    };
  }
  if (/top customer|best customer|biggest customer|customers by (revenue|sales)/.test(s)) {
    return {
      tool: "getSalesSummary",
      args: { groupBy: "customer", ...window, limit: 10 },
      layout: (r) => ({
        say: "Top customers by revenue over the last three full months.",
        components: [
          panel("Top customers", ["b"], ["Show sales by month", "Which orders are stuck in dispatch?"]),
          { id: "b", component: "BreakdownBar", title: "Revenue by customer", rows: { bind: `${r}.rows` }, labelField: "label", valueField: "revenueCents", format: "money", limit: 10 },
        ],
      }),
    };
  }
  if (/sales|revenue|trend|month|how are we doing|performance/.test(s)) {
    return {
      tool: "getSalesSummary",
      args: { groupBy: "month", ...window },
      layout: (r, has) => ({
        say: "Revenue for the last three full months, compared with the three months before.",
        components: [
          panel("Sales, last three full months", ["k", has("TrendChart") ? "c" : "t"], ["Who are the top customers?", "Which orders are stuck in dispatch?"]),
          {
            id: "k",
            component: "KpiStrip",
            items: [
              { label: "Revenue", value: { bind: `${r}.totals.revenueCents` }, previous: { bind: `${r}.previous.revenueCents` }, format: "money" },
              { label: "Orders", value: { bind: `${r}.totals.orders` }, previous: { bind: `${r}.previous.orders` }, format: "number" },
              { label: "Average order", value: { bind: `${r}.totals.avgOrderCents` }, previous: { bind: `${r}.previous.avgOrderCents` }, format: "money" },
            ],
          },
          has("TrendChart")
            ? { id: "c", component: "TrendChart", title: "Revenue", kind: "line", rows: { bind: `${r}.rows` }, xField: "label", series: [{ field: "revenueCents", label: "Revenue", format: "money" }] }
            : table("t", r, "By month", [
                ["label", "Month", "text"],
                ["revenueCents", "Revenue", "money"],
                ["orders", "Orders", "number"],
              ]),
        ],
      }),
    };
  }
  if (/customer|account|client/.test(s)) {
    const code = customerCode(q);
    if (code) {
      return {
        tool: "getCustomer",
        args: { code },
        layout: (r, _has, data) => ({
          say: `Customer ${code}.`,
          components: [
            panel(`Customer ${code}`, ["card"], [`Show the ledger for ${code}`]),
            {
              id: "card",
              component: "RecordCard",
              title: { bind: `${r}.name` },
              subtitle: { bind: `${r}.city` },
              fields: [
                { label: "Code", value: { bind: `${r}.code` }, type: "mono" },
                ...(data && "accountOwner" in data ? [{ label: "Account owner", value: { bind: `${r}.accountOwner` }, type: "text" }] : []),
                ...(data && "creditLimitCents" in data ? [{ label: "Credit limit", value: { bind: `${r}.creditLimitCents` }, type: "money" }] : []),
                ...(data && "balanceCents" in data ? [{ label: "Balance", value: { bind: `${r}.balanceCents` }, type: "money" }] : []),
              ],
            },
          ],
        }),
      };
    }
    return {
      tool: "listCustomers",
      args: { limit: 25 },
      layout: (r, _has, data) => {
        const credit = Array.isArray(data?.rows) && (data.rows as object[]).some((x) => "creditLimitCents" in x);
        return {
          say: "Customers you can see.",
          components: [
            panel("Customers", ["t"], ["Who are the top customers?"]),
            table("t", r, "Customers", [
              ["code", "Code", "mono"],
              ["name", "Name", "text"],
              ["city", "City", "text"],
              ...(credit ? ([["creditLimitCents", "Credit limit", "money"]] as [string, string, string][]) : []),
            ]),
          ],
        };
      },
    };
  }
  if (/order/.test(s)) {
    return {
      tool: "listOrders",
      args: { limit: 25, ...(/open|active/.test(s) ? { status: ["confirmed", "picking", "packed"] } : {}) },
      layout: (r, _has, data) => {
        const value = Array.isArray(data?.rows) && (data.rows as object[]).some((x) => "valueCents" in x);
        return {
          say: "Recent orders, newest first.",
          components: [
            panel("Orders", ["f", "t"], ["Which orders are stuck in dispatch?"]),
            {
              id: "f",
              component: "FilterBar",
              result: r,
              filters: [
                { key: "range", label: "Ordered", kind: "dateRange", value: null },
                { key: "status", label: "Status", kind: "select", options: ["confirmed", "picking", "packed", "dispatched", "delivered", "cancelled"], value: null },
                { key: "search", label: "Order number", kind: "text", value: null },
              ],
            },
            table("t", r, "Orders", [
              ["number", "Order", "mono"],
              ["customer", "Customer", "text"],
              ["status", "Status", "status"],
              ["orderedAt", "Ordered", "date"],
              ["lines", "Lines", "number"],
              ...(value ? ([["valueCents", "Value", "money"]] as [string, string, string][]) : []),
            ]),
          ],
        };
      },
    };
  }
  return null;
}

const NOT_ALLOWED: Record<string, [string, string, string]> = {
  getMargins: ["Margins are not available to your role", "Cost and margin figures are limited to owners.", "Ask about revenue or order volume instead."],
  getDispatchQueue: ["The dispatch queue is not available to your role", "Dispatch details are limited to the warehouse team and owners.", "Ask about the status of a specific order instead."],
  getStockLevels: ["Stock levels are not available to your role", "Stock figures are limited to sales, warehouse and owners.", "Ask about invoices or customer balances instead."],
  listPurchaseOrders: ["Purchase orders are not available to your role", "Purchasing is limited to the warehouse team and owners.", "Ask about stock or orders instead."],
  listInvoices: ["Invoices are not available to your role", "Invoices and payments are limited to accounts and owners.", "Ask about orders or stock instead."],
  getCustomerLedger: ["Ledgers are not available to your role", "Customer ledgers are limited to accounts and owners.", "Ask about the customer's orders instead."],
  getSalesSummary: ["Sales totals are not available to your role", "Revenue summaries are limited to sales and owners.", "Ask about invoices or customer balances instead."],
  listOrders: ["Orders are not available to your role", "Order lists are limited to sales, warehouse and owners.", "Ask about invoices instead."],
  getOrder: ["Orders are not available to your role", "Order details are limited to sales, warehouse and owners.", "Ask about the invoice for that order instead."],
  listApprovals: ["Approvals are not available to your role", "Approval requests are limited to owners, sales and accounts.", "Ask about stock or dispatch instead."],
};

/**
 * A deterministic stand-in for a language model, used by tests, the offline
 * demo and the eval suite. It goes through the same tool, validation, repair
 * and guard path as a real model. `badAttempts` makes the first N final
 * answers invalid, to exercise the repair loop.
 */
export class ScriptedModel implements ModelAdapter {
  readonly name = "scripted";
  private bad: number;

  constructor(opts: { badAttempts?: number } = {}) {
    this.bad = opts.badAttempts ?? 0;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const question = [...req.messages].reverse().find((m): m is ChatMessage & { role: "user" } => m.role === "user" && !m.content.startsWith("That answer was rejected"))!.content;
    const idx = req.messages.lastIndexOf(req.messages.find((m) => m.role === "user" && m.content === question)!);
    const after = req.messages.slice(idx + 1);
    const toolResults = after.filter((m) => m.role === "tool");
    const system = req.messages[0]?.role === "system" ? req.messages[0].content : "";
    const components = new Set([...system.matchAll(/^### (\w+)$/gm)].map((m) => m[1]!));
    const tools = new Set(req.tools.map((t) => t.name));
    const actions = system.match(/Actions this user can start:([\s\S]*?)\n\n/)?.[1] ?? "";
    const has = (c: string) => (c.startsWith("@") ? new RegExp(`- ${c.slice(1)}:`).test(actions) : components.has(c));
    const today = system.match(/Today is (\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().slice(0, 10);
    const p = plan(question, today);

    if (!req.final && toolResults.length === 0 && p && tools.has(p.tool)) {
      const call: ToolCall = { id: `call_${randomUUID().slice(0, 8)}`, type: "function", function: { name: p.tool, arguments: JSON.stringify(p.args) } };
      return { content: null, toolCalls: [call] };
    }
    if (this.bad > 0) {
      this.bad--;
      return { content: '{"say": "here", "surface": {"components": [{"id": "root", "component": "Chart"}]}}', toolCalls: [] };
    }

    let answer: { say: string; components: C[] };
    if (!p) {
      answer = refusal(
        "I can answer questions about orders, stock, dispatch, invoices and sales",
        "That question does not match the data I can look up.",
        "Try: which orders are stuck in dispatch this week?",
      );
    } else if (!tools.has(p.tool)) {
      const [title, body, next] = NOT_ALLOWED[p.tool] ?? ["That is not available to your role", "Your role cannot see this data.", "Ask about something your role covers."];
      answer = refusal(title, body, next);
    } else {
      const last = toolResults.at(-1)?.content ?? "";
      const rid = last.match(/Tool result (r\d+)/)?.[1];
      const err = last.startsWith("{") ? (JSON.parse(last) as { error?: string }).error : undefined;
      if (!rid) {
        answer = refusal("Nothing found", err?.replace(/^\w+: /, "") ?? "The lookup returned nothing.", "Check the number or code and ask again.");
      } else {
        const data = JSON.parse(last.slice(last.indexOf("\n") + 1)).data as Record<string, unknown>;
        answer = p.layout(rid, has, data);
      }
    }
    return { content: JSON.stringify({ say: answer.say, surface: { components: answer.components } }), toolCalls: [] };
  }
}
