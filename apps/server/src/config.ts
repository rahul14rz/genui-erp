import { z } from "zod";

const DEV_SECRET = "genui-erp-local-development-secret-change-me";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().default("postgres://genui_app:genui_app_local@localhost:5432/genui_erp"),
  JWT_SECRET: z.string().min(32).optional(),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 3600),
});

export type Config = {
  env: "development" | "test" | "production";
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(source);
  if (e.NODE_ENV === "production" && !e.JWT_SECRET) throw new Error("JWT_SECRET is required in production");
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET ?? DEV_SECRET,
    jwtTtlSeconds: e.JWT_TTL_SECONDS,
  };
}
