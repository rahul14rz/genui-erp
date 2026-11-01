import { lookupLogin, withScope, tenants, type Scope } from "@genui-erp/db";
import { verifyPassword } from "@genui-erp/db/password";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { actionsFor, previewAction, runAction } from "./actions/execute.ts";
import { scopeOf, signToken, verifyToken } from "./auth/jwt.ts";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";
import { ROLE_PERMISSIONS } from "./generated/permissions.ts";
import { registerA2a } from "./agent/a2a.ts";
import { ScriptedModel } from "./model/scripted.ts";
import type { ModelAdapter } from "./model/types.ts";
import { runTool, toolsFor } from "./tools/registry.ts";

declare module "fastify" {
  interface FastifyRequest {
    scope: Scope;
  }
}

export type AppDeps = {
  config: Config;
  pool: pg.Pool;
  logger?: boolean;
  now?: () => Date;
  model?: ModelAdapter;
  failureLog?: string;
};

const PUBLIC_ROUTES = new Set(["/health", "/auth/login", "/.well-known/agent-card.json"]);
// Run against a fixed hash when the email is unknown, so a miss takes as long
// as a wrong password and response time does not reveal which emails exist.
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const Login = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export function buildApp({ config, pool, logger = false, now = () => new Date(), model = new ScriptedModel(), failureLog }: AppDeps): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 256 * 1024 });
  app.decorateRequest("scope", null as unknown as Scope);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: "invalid", message: (err as Error).message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong on the server." } });
  });

  // The web client is served from another origin in development.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("access-control-allow-origin", config.corsOrigin);
    reply.header("access-control-allow-headers", "authorization, content-type, idempotency-key, x-a2a-extensions");
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return reply.status(204).send();
  });

  app.addHook("onRequest", async (req) => {
    if (req.method === "OPTIONS") return;
    if (PUBLIC_ROUTES.has(req.routeOptions.url ?? "")) return;
    const header = req.headers.authorization ?? "";
    const claims = header.startsWith("Bearer ") ? verifyToken(header.slice(7), config.jwtSecret) : null;
    if (!claims) throw new AppError("unauthorized", "Sign in again to continue.");
    req.scope = scopeOf(claims);
  });

  app.get("/health", async () => {
    await pool.query("select 1");
    return { ok: true };
  });

  app.post("/auth/login", async (req) => {
    const body = Login.safeParse(req.body);
    if (!body.success) throw new AppError("invalid", "Enter an email and password.");
    const user = await lookupLogin(pool, body.data.email);
    const ok = await verifyPassword(body.data.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError("unauthorized", "That email and password do not match.");
    const scope: Scope = { tenantId: user.tenantId, userId: user.id, role: user.role };
    const [tenant] = await withScope(pool, scope, (db) =>
      db.select({ name: tenants.name, slug: tenants.slug, currency: tenants.currency }).from(tenants),
    );
    const token = signToken({ sub: user.id, tid: user.tenantId, role: user.role, name: user.name }, config.jwtSecret, config.jwtTtlSeconds);
    return { token, user: { name: user.name, role: user.role }, tenant };
  });

  app.get("/me", async (req) => ({
    role: req.scope.role,
    permissions: ROLE_PERMISSIONS[req.scope.role],
    tools: toolsFor(req.scope.role).map((t) => t.name),
    actions: actionsFor(req.scope.role).map((a) => a.name),
  }));

  app.get("/api/tools", async (req) =>
    toolsFor(req.scope.role).map((t) => ({ name: t.name, description: t.description, permission: t.permission })),
  );

  app.post<{ Params: { name: string } }>("/api/tools/:name", async (req) =>
    runTool(pool, req.scope, req.params.name, req.body, now()),
  );

  app.post<{ Params: { name: string } }>("/api/actions/:name/preview", async (req) =>
    previewAction(pool, req.scope, req.params.name, req.body, now()),
  );

  app.post<{ Params: { name: string } }>("/api/actions/:name", async (req) => {
    const key = req.headers["idempotency-key"];
    return runAction(pool, req.scope, req.params.name, req.body, Array.isArray(key) ? key[0] : key, now());
  });

  registerA2a(app, { pool, model, now, failureLog, publicUrl: config.publicUrl });

  return app;
}
