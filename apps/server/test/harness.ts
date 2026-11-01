import { createPool, type Role } from "@genui-erp/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

export const ANCHOR = new Date("2026-06-30T00:00:00Z");
export const NOW = new Date("2026-06-30T12:00:00Z");
export const ADMIN_URL =
  process.env.TEST_SERVER_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/genui_erp_test_server";
export const APP_PASSWORD = process.env.GENUI_APP_PASSWORD ?? "genui_app_local";
export const APP_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.username = "genui_app";
  u.password = APP_PASSWORD;
  return u.toString();
})();

export const DOMAINS = { northfield: "northfield.test", coastline: "coastline.test" } as const;
export const emailFor = (tenant: keyof typeof DOMAINS, role: Role) => `${role.replace("_", "")}@${DOMAINS[tenant]}`;

export type Harness = {
  app: FastifyInstance;
  close: () => Promise<void>;
  login: (tenant: keyof typeof DOMAINS, role: Role) => Promise<string>;
  call: (token: string, method: "GET" | "POST", url: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
};

export async function startHarness(): Promise<Harness> {
  const pool = createPool(APP_URL);
  const app = buildApp({ config: { ...loadConfig({ NODE_ENV: "test" }), databaseUrl: APP_URL }, pool, now: () => NOW });
  await app.ready();
  const tokens = new Map<string, string>();
  const call: Harness["call"] = async (token, method, url, body, headers = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, ...headers },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    return { status: res.statusCode, body: res.json() };
  };
  return {
    app,
    call,
    close: async () => {
      await app.close();
      await pool.end();
    },
    login: async (tenant, role) => {
      const k = `${tenant}:${role}`;
      if (!tokens.has(k)) {
        const res = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: emailFor(tenant, role), password: "genui-erp-local" },
        });
        tokens.set(k, res.json().token);
      }
      return tokens.get(k)!;
    },
  };
}
