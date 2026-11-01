import { auditLog, withScope, type Role, type Scope } from "@genui-erp/db";
import { and, eq } from "drizzle-orm";
import type pg from "pg";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { can } from "../permissions.ts";
import {
  adjustPrice,
  adjustStock,
  createQuote,
  decideApproval,
  markDispatched,
  recordPayment,
  requestDiscount,
} from "./handlers.ts";
import type { Action, Preview } from "./types.ts";

export const ACTIONS: readonly Action[] = [
  markDispatched,
  adjustStock,
  requestDiscount,
  createQuote,
  decideApproval,
  adjustPrice,
  recordPayment,
] as Action[];

export const actionsFor = (role: Role): Action[] => ACTIONS.filter((a) => can(role, a.permission));

export type ActionResult = { action: string; preview: Preview; result: Record<string, unknown>; replayed: boolean };

/** Key order must not matter when comparing a replayed request with the original. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

async function audit(
  pool: pg.Pool,
  scope: Scope,
  action: string,
  outcome: "denied" | "invalid" | "error",
  input: unknown,
  idempotencyKey: string | null,
  detail: string,
) {
  await withScope(pool, scope, (db) =>
    db.insert(auditLog).values({
      tenantId: scope.tenantId,
      userId: scope.userId,
      role: scope.role,
      action,
      outcome,
      idempotencyKey,
      input: (input ?? {}) as object,
      result: { detail },
    }),
  );
}

function authorize(scope: Scope, name: string): Action | null {
  const action = ACTIONS.find((a) => a.name === name);
  return action && can(scope.role, action.permission) ? action : null;
}

function parse(action: Action, raw: unknown): unknown {
  const parsed = action.input.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("invalid", "Action input is invalid.", z.treeifyError(parsed.error));
  return parsed.data;
}

/** Computes what an action would change without writing anything. */
export async function previewAction(pool: pg.Pool, scope: Scope, name: string, raw: unknown, now = new Date()) {
  const action = authorize(scope, name);
  if (!action) {
    await audit(pool, scope, name, "denied", raw, null, "preview denied");
    throw new AppError("forbidden", `You cannot ${name}.`);
  }
  const input = parse(action, raw);
  return withScope(pool, scope, async (db) => {
    const { preview } = await action.prepare({ db, scope, now }, input);
    return { action: name, preview };
  });
}

/**
 * Runs an action once per idempotency key. The permission is checked again
 * here no matter what the client showed, the write and its audit row commit
 * together, and a replayed key returns the stored result without writing.
 */
export async function runAction(
  pool: pg.Pool,
  scope: Scope,
  name: string,
  raw: unknown,
  idempotencyKey: string | undefined,
  now = new Date(),
): Promise<ActionResult> {
  const action = authorize(scope, name);
  if (!action) {
    await audit(pool, scope, name, "denied", raw, idempotencyKey ?? null, "permission denied");
    throw new AppError("forbidden", `You cannot ${name}.`);
  }
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) {
    await audit(pool, scope, name, "invalid", raw, null, "missing or malformed idempotency key");
    throw new AppError("invalid", "An Idempotency-Key header of 8 to 100 characters is required.");
  }
  let input: unknown;
  try {
    input = parse(action, raw);
  } catch (err) {
    await audit(pool, scope, name, "invalid", raw, idempotencyKey, "input failed validation");
    throw err;
  }

  const findPrior = async () =>
    withScope(pool, scope, async (db) => {
      const [prior] = await db
        .select({ input: auditLog.input, result: auditLog.result })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.userId, scope.userId),
            eq(auditLog.action, name),
            eq(auditLog.idempotencyKey, idempotencyKey),
            eq(auditLog.outcome, "ok"),
          ),
        );
      return prior;
    });
  const replay = (prior: { input: unknown; result: unknown }): ActionResult => {
    if (canonical(prior.input) !== canonical(input)) {
      throw new AppError("conflict", "This idempotency key was already used with different input.");
    }
    return { ...(prior.result as Omit<ActionResult, "replayed">), replayed: true };
  };

  const prior = await findPrior();
  if (prior) return replay(prior);

  try {
    return await withScope(pool, scope, async (db) => {
      const { preview, apply } = await action.prepare({ db, scope, now }, input);
      const result = await apply();
      const stored = { action: name, preview, result };
      await db.insert(auditLog).values({
        tenantId: scope.tenantId,
        userId: scope.userId,
        role: scope.role,
        action: name,
        outcome: "ok",
        idempotencyKey,
        input: input as object,
        result: stored,
      });
      return { ...stored, replayed: false };
    });
  } catch (err) {
    // A concurrent request with the same key won the race. Its row is the
    // answer for this one too.
    if ((err as { cause?: { code?: string }; code?: string }).cause?.code === "23505") {
      const winner = await findPrior();
      if (winner) return replay(winner);
    }
    const outcome = err instanceof AppError ? "invalid" : "error";
    await audit(pool, scope, name, outcome, input, idempotencyKey, err instanceof Error ? err.message : "unknown error");
    throw err;
  }
}
