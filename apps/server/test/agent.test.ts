import { generate } from "@genui-erp/db/seed";
import { createPool, type Role } from "@genui-erp/db";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogFor } from "../src/agent/catalog.ts";
import { createEmitter, type Part } from "../src/agent/emit.ts";
import { guardMessage } from "../src/agent/guard.ts";
import { buildSurface, type StoredResult } from "../src/agent/surface.ts";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { ScriptedModel } from "../src/model/scripted.ts";
import type { CompletionRequest, ModelAdapter } from "../src/model/types.ts";
import { ADMIN_URL, ANCHOR, APP_URL, NOW, emailFor } from "./harness.ts";

const data = generate(ANCHOR);
const north = data.tenants.find((t) => t.slug === "northfield")!;
const silentLog = { warn() {}, error() {}, info() {} } as never;

type Frame = { state: string; final: boolean; parts: Part[]; metadata?: { erpStats?: Record<string, unknown> }; contextId: string };

async function startApp(model: ModelAdapter, failureLog?: string) {
  const pool = createPool(APP_URL);
  const app = buildApp({ config: { ...loadConfig({ NODE_ENV: "test" }), databaseUrl: APP_URL }, pool, now: () => NOW, model, failureLog });
  await app.ready();
  const login = async (role: Role, tenant: "northfield" | "coastline" = "northfield") =>
    (await app.inject({ method: "POST", url: "/auth/login", payload: { email: emailFor(tenant, role), password: "genui-erp-local" } })).json().token as string;
  const stream = async (token: string, parts: Part[], contextId?: string): Promise<Frame[]> => {
    const res = await app.inject({
      method: "POST",
      url: "/a2a",
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
      payload: { jsonrpc: "2.0", id: 1, method: "message/stream", params: { message: { messageId: "m", role: "user", parts, contextId } } },
    });
    if (res.statusCode !== 200) throw Object.assign(new Error(`status ${res.statusCode}`), { status: res.statusCode });
    return res.body
      .split("\n\n")
      .filter((b) => b.startsWith("data: "))
      .map((b) => JSON.parse(b.slice(6)).result)
      .map((e) => ({ state: e.status.state, final: e.final, parts: e.status.message.parts, metadata: e.status.message.metadata, contextId: e.contextId }));
  };
  const ask = (token: string, text: string, contextId?: string) => stream(token, [{ kind: "text", text }], contextId);
  const act = (token: string, contextId: string, name: string, surfaceId: string, sourceComponentId: string, context: Record<string, unknown>) =>
    stream(token, [{ kind: "data", data: { version: "v0.9", action: { name, surfaceId, sourceComponentId, context } } }], contextId);
  return { app, login, ask, act, close: async () => (await app.close(), await pool.end()) };
}

const dataParts = (frames: Frame[]) => frames.flatMap((f) => f.parts).filter((p): p is Extract<Part, { kind: "data" }> => p.kind === "data").map((p) => p.data);
const updates = (frames: Frame[]) =>
  dataParts(frames)
    .filter((d) => "updateComponents" in d)
    .map((d) => (d as { updateComponents: { surfaceId: string; components: Record<string, unknown>[] } }).updateComponents);
const statuses = (frames: Frame[]) => dataParts(frames).filter((d) => "erpStatus" in d).map((d) => d.erpStatus);
const stats = (frames: Frame[]) => frames.at(-1)!.metadata?.erpStats as Record<string, unknown>;

describe("guard", () => {
  it("rejects components outside the role's catalog", () => {
    const warehouse = catalogFor("warehouse");
    const msg = {
      version: "v0.9" as const,
      updateComponents: { surfaceId: "s1", components: [{ id: "f", component: "ApprovalForm", requestId: "x", title: "t", requestedBy: "a", reason: "r", impact: [] }] },
    };
    expect(guardMessage(msg, warehouse)).toEqual(["component ApprovalForm is not in the warehouse catalog"]);
    expect(guardMessage(msg, catalogFor("owner"))).toEqual([]);
  });

  it("rejects actions the role cannot run, wherever they appear", () => {
    const msg = {
      version: "v0.9" as const,
      updateComponents: {
        surfaceId: "s1",
        components: [
          {
            id: "t",
            component: "DataTable",
            columns: [{ key: "a", label: "A", type: "text" }],
            rows: [{ a: 1 }],
            rowActions: [{ action: "adjustPrice", label: "Reprice", input: {} }],
          },
        ],
      },
    };
    expect(guardMessage(msg, catalogFor("sales_rep"))[0]).toMatch(/adjustPrice/);
    expect(guardMessage(msg, catalogFor("owner"))).toEqual([]);
  });

  it("replaces a rejected message with an error notice", () => {
    const written: Part[][] = [];
    const emit = createEmitter((p) => written.push(p), catalogFor("warehouse"), silentLog);
    emit.a2ui({ version: "v0.9", updateComponents: { surfaceId: "s9", components: [{ id: "root", component: "TrendChart", kind: "line", rows: [], xField: "x", series: [] }] } });
    const sent = written.flat().map((p) => (p as { data: Record<string, unknown> }).data);
    expect(JSON.stringify(sent)).not.toContain("TrendChart");
    expect(JSON.stringify(sent)).toContain("This answer was blocked");
  });
});

describe("buildSurface", () => {
  const results = new Map<string, StoredResult>([
    ["r1", { id: "r1", tool: "listOrders", input: { limit: 25, offset: 0 }, data: { total: 2, rows: [{ number: "SO-1", customer: "A" }, { number: "SO-2", customer: "B" }] }, source: { tables: ["sales_orders"], filters: {}, at: "x" } }],
  ]);
  const catalog = catalogFor("owner");
  const answer = (cols: string[], bind = "r1.rows") => ({
    surface: {
      components: [
        { id: "root", component: "Panel", title: "Orders", children: ["t"] },
        { id: "t", component: "DataTable", columns: cols.map((k) => ({ key: k, label: k, type: "text" })), rows: { bind } },
      ],
    },
  });

  it("resolves bindings, adds the source footer and paging", () => {
    const r = buildSurface(answer(["number", "customer"]), catalog, results);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [panel, table] = r.built.components;
    expect(panel!.source).toEqual([{ tables: ["sales_orders"], filters: {}, at: "x" }]);
    expect(table!.rows).toHaveLength(2);
    expect(table).toMatchObject({ total: 2, pageSize: 25, offset: 0 });
  });

  it("rejects a column that is not in the bound rows", () => {
    const r = buildSurface(answer(["number", "marginCents"]), catalog, results);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join()).toMatch(/field "marginCents" is not in the bound rows/);
  });

  it("rejects a binding to a result that does not exist", () => {
    const r = buildSurface(answer(["number"], "r7.rows"), catalog, results);
    expect(!r.ok && r.errors.join()).toMatch(/result "r7"/);
  });

  it("rejects literal numbers where none are allowed and a missing root", () => {
    const r = buildSurface({ surface: { components: [{ id: "x", component: "Notice", tone: "info", title: "t", body: "b" }] } }, catalog, results);
    expect(!r.ok && r.errors.join()).toMatch(/root/);
  });
});

describe("agent over A2A", () => {
  let h: Awaited<ReturnType<typeof startApp>>;
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
  beforeAll(async () => {
    h = await startApp(new ScriptedModel());
  });
  afterAll(async () => {
    await h.close();
    await admin.end();
  });

  it("serves the agent card without a token and refuses the stream without one", async () => {
    const card = await h.app.inject({ method: "GET", url: "/.well-known/agent-card.json" });
    expect(card.json().capabilities.extensions[0].uri).toBe("https://a2ui.org/a2a-extension/a2ui/v0.9");
    await expect(h.ask("", "hello")).rejects.toMatchObject({ status: 401 });
  });

  it("streams a status line before the first surface", async () => {
    const frames = await h.ask(await h.login("warehouse"), "which orders are stuck in dispatch this week?");
    const order = dataParts(frames).map((d) => Object.keys(d).find((k) => k !== "version"));
    expect(order.indexOf("erpStatus")).toBeLessThan(order.indexOf("createSurface"));
    expect(statuses(frames)).toContain("Checking the dispatch queue");
    const [u] = updates(frames);
    expect(u!.components.map((c) => c.component)).toEqual(["Panel", "DataTable"]);
    expect(frames.at(-1)).toMatchObject({ state: "completed", final: true });
  });

  it("refuses margins to a sales rep without calling a tool", async () => {
    const frames = await h.ask(await h.login("sales_rep"), "show me margins by category");
    expect(stats(frames).tools).toEqual([]);
    const body = JSON.stringify(updates(frames));
    expect(body).toContain("Margins are not available to your role");
    expect(body).not.toMatch(/marginCents|costCents/);
  });

  it("shows warehouse no row action it cannot run and the rep no ApprovalForm", async () => {
    const wh = JSON.stringify(updates(await h.ask(await h.login("warehouse"), "which orders are stuck in dispatch?")));
    expect(wh).toContain("markDispatched");
    const rep = updates(await h.ask(await h.login("sales_rep"), "any pending approvals?"));
    expect(rep[0]!.components.map((c) => c.component)).not.toContain("ApprovalForm");
  });

  it("pages a table on the server without asking the model", async () => {
    const token = await h.login("owner");
    const first = await h.ask(token, "show recent orders");
    const ctx = first[0]!.contextId;
    const table = updates(first)[0]!.components.find((c) => c.component === "DataTable")!;
    const next = await h.act(token, ctx, "table.page", "s1", String(table.id), { offset: 25 });
    const paged = updates(next)[0]!.components.find((c) => c.component === "DataTable")!;
    expect(paged.offset).toBe(25);
    expect((paged.rows as { number: string }[])[0]!.number).not.toBe((table.rows as { number: string }[])[0]!.number);
  });

  it("runs an action only after a preview and a confirm, from the server's copy of the input", async () => {
    const token = await h.login("warehouse");
    const first = await h.ask(token, "which orders are stuck in dispatch?");
    const ctx = first[0]!.contextId;
    // The newest row, so this test does not touch the rows the action contract tests use.
    const row = (updates(first)[0]!.components.find((c) => c.component === "DataTable")!.rows as { orderNumber: string }[]).at(-1)!;
    const preview = await h.act(token, ctx, "action.preview", "s1", "t", { action: "markDispatched", input: { orderNumber: row.orderNumber, carrier: "Royal Parcel" } });
    const confirm = updates(preview)[0]!.components.find((c) => c.component === "ConfirmAction")!;
    expect(confirm.changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: "status", to: "dispatched" })]));
    const before = await admin.query("select d.status from dispatches d join sales_orders o on o.id = d.order_id where o.number = $1", [row.orderNumber]);
    expect(before.rows[0].status).not.toBe("dispatched");

    // A forged confirm with a key the server never issued writes nothing.
    await h.act(token, ctx, "action.confirm", "c2", "confirm", { idempotencyKey: "forged-key-123456" });
    const still = await admin.query("select d.status from dispatches d join sales_orders o on o.id = d.order_id where o.number = $1", [row.orderNumber]);
    expect(still.rows[0].status).toBe(before.rows[0].status);

    const done = await h.act(token, ctx, "action.confirm", String(confirm.id), "confirm", { idempotencyKey: confirm.idempotencyKey, input: { orderNumber: "SO-99999" } });
    expect(JSON.stringify(updates(done))).toContain("Change saved");
    const after = await admin.query("select d.status, d.carrier from dispatches d join sales_orders o on o.id = d.order_id where o.number = $1", [row.orderNumber]);
    expect(after.rows[0]).toEqual({ status: "dispatched", carrier: "Royal Parcel" });
  });

  it("re-checks the permission when a preview names an action the role lacks", async () => {
    const token = await h.login("warehouse");
    const first = await h.ask(token, "what stock is running low?");
    const out = await h.act(token, first[0]!.contextId, "action.preview", "s1", "t", { action: "adjustPrice", input: { sku: "SH-01-S", priceCents: 1, reason: "cheap" } });
    expect(JSON.stringify(updates(out))).toContain("Nothing was changed");
    expect(JSON.stringify(updates(out))).not.toContain("ConfirmAction");
  });

  it("does not let one user page another user's results", async () => {
    const owner = await h.login("owner");
    const first = await h.ask(owner, "show recent orders");
    const ctx = first[0]!.contextId;
    const rep = await h.login("sales_rep");
    const out = await h.act(rep, ctx, "table.page", "s1", "t", { offset: 25 });
    expect(out[0]!.contextId).not.toBe(ctx);
    expect(updates(out)).toHaveLength(0);
  });
});

describe("repair and fallback", () => {
  const failureLog = join(tmpdir(), `genui-erp-failures-${process.pid}.jsonl`);
  afterAll(() => existsSync(failureLog) && rmSync(failureLog));

  it("repairs an invalid answer and reports it", async () => {
    const h = await startApp(new ScriptedModel({ badAttempts: 1 }), failureLog);
    try {
      const frames = await h.ask(await h.login("owner"), "show sales by month");
      expect(stats(frames)).toMatchObject({ attempts: 2, firstValid: false, repaired: true, fallback: false });
      expect(updates(frames)).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it("falls back to text after two failed repairs and logs the raw output", async () => {
    const h = await startApp(new ScriptedModel({ badAttempts: 3 }), failureLog);
    try {
      const frames = await h.ask(await h.login("owner"), "show sales by month");
      expect(stats(frames)).toMatchObject({ attempts: 3, fallback: true });
      expect(updates(frames)).toHaveLength(0);
      expect(frames.flatMap((f) => f.parts).some((p) => p.kind === "text")).toBe(true);
      const logged = readFileSync(failureLog, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(logged.at(-1)).toMatchObject({ role: "owner", question: "show sales by month" });
      expect(logged.at(-1).raw).toHaveLength(3);
    } finally {
      await h.close();
    }
  });

  it("sends the model only the tools the role holds", async () => {
    const seen: string[][] = [];
    const spy: ModelAdapter = {
      name: "spy",
      async complete(req: CompletionRequest) {
        seen.push(req.tools.map((t) => t.name));
        return { content: JSON.stringify({ surface: { components: [{ id: "root", component: "Panel", title: "x", children: ["n"] }, { id: "n", component: "Notice", tone: "info", title: "t", body: "b" }] } }), toolCalls: [] };
      },
    };
    const h = await startApp(spy);
    try {
      await h.ask(await h.login("accounts"), "anything");
      expect(seen[0]!.sort()).toEqual(["getCustomer", "getCustomerLedger", "listApprovals", "listCustomers", "listInvoices"]);
      void north;
    } finally {
      await h.close();
    }
  });
});
