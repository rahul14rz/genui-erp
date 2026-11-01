import { tenants, users, withScope } from "@genui-erp/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { AppError } from "../errors.ts";
import type { ModelAdapter } from "../model/types.ts";
import { catalogFor } from "./catalog.ts";
import { createEmitter, type Part } from "./emit.ts";
import { Agent, type TurnStats } from "./run.ts";
import { SessionStore } from "./session.ts";

export const A2UI_EXTENSION = "https://a2ui.org/a2a-extension/a2ui/v0.9";

const IncomingPart = z.union([
  z.object({ kind: z.literal("text"), text: z.string().max(2000) }),
  z.object({ kind: z.literal("data"), data: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("file") }).loose(),
]);
const IncomingMessage = z
  .object({
    messageId: z.string(),
    role: z.literal("user"),
    parts: z.array(IncomingPart).max(10),
    contextId: z.string().max(80).nullish(),
  })
  .loose();
type IncomingMessage = z.infer<typeof IncomingMessage>;
const Rpc = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).nullable().optional(),
  method: z.string(),
  params: z
    .object({
      message: IncomingMessage,
    })
    .loose()
    .optional(),
});
const UserAction = z.object({
  version: z.literal("v0.9"),
  action: z.object({
    name: z.string().max(60),
    surfaceId: z.string().max(40).optional(),
    sourceComponentId: z.string().max(40).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type A2aDeps = { pool: pg.Pool; model: ModelAdapter; now: () => Date; failureLog?: string; publicUrl: string };

export function registerA2a(app: FastifyInstance, deps: A2aDeps) {
  const store = new SessionStore();
  const agent = new Agent({ pool: deps.pool, model: deps.model, log: app.log, now: deps.now, failureLog: deps.failureLog });

  app.get("/.well-known/agent-card.json", async () => ({
    name: "genui-erp",
    description: "Answers questions about a wholesale ERP with tables, charts and forms, limited to what the signed-in role may see.",
    url: `${deps.publicUrl}/a2a`,
    version: "0.1.0",
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    capabilities: { streaming: true, extensions: [{ uri: A2UI_EXTENSION, description: "A2UI v0.9 surfaces", required: true }] },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json"],
    securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    security: [{ bearer: [] }],
    skills: [{ id: "erp-questions", name: "ERP questions", description: "Orders, stock, dispatch, invoices, sales and approvals.", tags: ["erp"] }],
  }));

  app.post("/a2a", async (req, reply) => {
    const rpc = Rpc.safeParse(req.body);
    if (!rpc.success) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
    const { id = null, method, params } = rpc.data;
    if (method !== "message/stream" && method !== "message/send") {
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method ${method} is not supported` } };
    }
    if (!params?.message) return { jsonrpc: "2.0", id, error: { code: -32602, message: "params.message is required" } };
    return method === "message/stream" ? stream(req, reply, id, params.message) : send(req, id, params.message);
  });

  async function openSession(req: FastifyRequest, contextId: string | undefined) {
    const scope = req.scope;
    const [row] = await withScope(deps.pool, scope, (db) =>
      db
        .select({ tenant: tenants.name, currency: tenants.currency, user: users.name })
        .from(tenants)
        .innerJoin(users, eq(users.id, scope.userId)),
    );
    if (!row) throw new AppError("unauthorized", "Sign in again to continue.");
    return store.get(contextId, scope, { userName: row.user, tenant: { name: row.tenant, currency: row.currency } }, randomUUID);
  }

  /** Runs one incoming message through the agent, writing parts as they are produced. */
  async function handle(req: FastifyRequest, message: IncomingMessage, write: (parts: Part[]) => void, session: Awaited<ReturnType<typeof openSession>>): Promise<TurnStats | null> {
    const emit = createEmitter(write, catalogFor(session.scope.role), req.log);
    for (const part of message.parts) {
      if (part.kind === "text" && part.text.trim()) return agent.ask(session, part.text.trim(), emit);
      if (part.kind === "data") {
        const action = UserAction.safeParse(part.data);
        if (action.success) {
          await agent.event(session, action.data.action, emit);
          return null;
        }
      }
    }
    emit.text("Ask a question about orders, stock, dispatch, invoices or sales.");
    return null;
  }

  async function stream(req: FastifyRequest, reply: FastifyReply, id: string | number | null, message: IncomingMessage) {
    const session = await openSession(req, message.contextId ?? undefined);
    const taskId = randomUUID();
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": (reply.getHeader("access-control-allow-origin") as string) ?? "*",
    });
    const frame = (state: string, parts: Part[], final = false, metadata?: Record<string, unknown>) => {
      const event = {
        kind: "status-update",
        taskId,
        contextId: session.contextId,
        final,
        status: {
          state,
          timestamp: deps.now().toISOString(),
          message: { kind: "message", role: "agent", messageId: randomUUID(), taskId, contextId: session.contextId, parts, ...(metadata ? { metadata } : {}) },
        },
      };
      reply.raw.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id, result: event })}\n\n`);
    };
    try {
      const stats = await handle(req, message, (parts) => frame("working", parts), session);
      frame("completed", [], true, stats ? { erpStats: stats } : undefined);
    } catch (err) {
      req.log.error({ err }, "agent turn failed");
      frame("working", [{ kind: "text", text: "Something went wrong while answering. Nothing was changed. Try again in a moment." }]);
      frame("failed", [], true);
    } finally {
      reply.raw.end();
    }
  }

  async function send(req: FastifyRequest, id: string | number | null, message: IncomingMessage) {
    const session = await openSession(req, message.contextId ?? undefined);
    const parts: Part[] = [];
    const stats = await handle(req, message, (p) => parts.push(...p), session);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        kind: "task",
        id: randomUUID(),
        contextId: session.contextId,
        status: {
          state: "completed",
          timestamp: deps.now().toISOString(),
          message: { kind: "message", role: "agent", messageId: randomUUID(), parts, ...(stats ? { metadata: { erpStats: stats } } : {}) },
        },
      },
    };
  }
}
