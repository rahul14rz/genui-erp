import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";
import type { Role } from "./schema.ts";

export * from "./schema.ts";
export { schema };

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };
export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;

export type Scope = { readonly tenantId: TenantId; readonly userId: UserId; readonly role: Role };
export type ScopedDb = NodePgDatabase<typeof schema>;

const PG_ROLE: Record<Role, string> = {
  owner: "genui_role_owner",
  sales_rep: "genui_role_sales_rep",
  warehouse: "genui_role_warehouse",
  accounts: "genui_role_accounts",
};

// pg returns bigint as string by default. Every bigint here is money in
// cents, well inside Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/**
 * The only way application code reaches the database. Runs `fn` in one
 * transaction as the role's Postgres role, with the tenant and user set for
 * RLS. Everything resets at commit or rollback, so pooled connections never
 * carry one request's scope into the next.
 */
export async function withScope<T>(
  pool: pg.Pool,
  scope: Scope,
  fn: (db: ScopedDb) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${PG_ROLE[scope.role]}`);
    await client.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.user_role', $3, true)",
      [scope.tenantId, scope.userId, scope.role],
    );
    const result = await fn(drizzle(client, { schema }));
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type AuthRecord = {
  id: UserId;
  tenantId: TenantId;
  role: Role;
  name: string;
  passwordHash: string;
};

export async function lookupLogin(pool: pg.Pool, email: string): Promise<AuthRecord | null> {
  const { rows } = await pool.query<{
    id: string;
    tenant_id: string;
    role: Role;
    name: string;
    password_hash: string;
  }>("select * from auth_lookup($1)", [email]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id as UserId,
    tenantId: row.tenant_id as TenantId,
    role: row.role,
    name: row.name,
    passwordHash: row.password_hash,
  };
}

/** True when the user still exists with this tenant and role. */
export async function userStillValid(pool: pg.Pool, scope: Scope): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>("select auth_check($1, $2, $3) as ok", [scope.userId, scope.tenantId, scope.role]);
  return rows[0]?.ok === true;
}
