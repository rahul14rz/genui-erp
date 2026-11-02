import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seed } from "../seed/seed.ts";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Drops and recreates the database named in `adminUrl`, applies migrations,
 * enables the app login, and seeds. Used by `pnpm db:reset` and the tests.
 */
export async function resetDatabase(opts: {
  adminUrl: string;
  appPassword: string;
  anchor: Date;
}): Promise<void> {
  const url = new URL(opts.adminUrl);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`unsafe database name: ${dbName}`);
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";

  const root = new pg.Client({ connectionString: maintenance.toString() });
  await root.connect();
  try {
    await root.query(`drop database if exists ${dbName} with (force)`);
    await root.query(`create database ${dbName}`);
  } finally {
    await root.end();
  }

  const pool = new pg.Pool({ connectionString: opts.adminUrl, max: 4 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
    await pool.query(`alter role genui_app login password ${pg.escapeLiteral(opts.appPassword)}`);
    await seed(pool, opts.anchor);
  } finally {
    await pool.end();
  }
}

/**
 * Applies pending migrations and seeds only when the database has no tenants.
 * Safe to run on every container start.
 */
export async function setupDatabase(opts: { adminUrl: string; appPassword: string; anchor: Date }): Promise<"seeded" | "kept"> {
  const pool = new pg.Pool({ connectionString: opts.adminUrl, max: 4 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
    await pool.query(`alter role genui_app login password ${pg.escapeLiteral(opts.appPassword)}`);
    const { rows } = await pool.query("select count(*)::int as n from tenants");
    if (rows[0].n > 0) return "kept";
    await seed(pool, opts.anchor);
    return "seeded";
  } finally {
    await pool.end();
  }
}
