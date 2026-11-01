import { withScope, type Role, type Scope } from "@genui-erp/db";
import type pg from "pg";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { can } from "../permissions.ts";
import { getCustomer, getCustomerLedger, listCustomers, listInvoices } from "./finance.ts";
import { getDispatchQueue, getOrder, listOrders } from "./orders.ts";
import { getMargins, getSalesSummary, listApprovals } from "./sales.ts";
import { getStockLevels, listPurchaseOrders } from "./stock.ts";
import type { Source, Tool } from "./types.ts";

export const TOOLS: readonly Tool[] = [
  listOrders,
  getOrder,
  getDispatchQueue,
  getStockLevels,
  listPurchaseOrders,
  listCustomers,
  getCustomer,
  getCustomerLedger,
  listInvoices,
  getSalesSummary,
  getMargins,
  listApprovals,
] as Tool[];

/** The tools a role may call. Nothing outside this list is ever described to the model. */
export const toolsFor = (role: Role): Tool[] => TOOLS.filter((t) => can(role, t.permission));

export type ToolResult = { tool: string; data: unknown; source: Source };

export async function runTool(
  pool: pg.Pool,
  scope: Scope,
  name: string,
  rawInput: unknown,
  now = new Date(),
): Promise<ToolResult> {
  const tool = toolsFor(scope.role).find((t) => t.name === name);
  if (!tool) {
    // Same answer whether the tool exists or not, so callers learn nothing.
    throw new AppError("forbidden", `Tool ${name} is not available to you.`);
  }
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new AppError("invalid", "Tool input is invalid.", z.treeifyError(parsed.error));
  const out = await withScope(pool, scope, (db) =>
    tool.run({ db, scope, now, can: (p) => can(scope.role, p) }, parsed.data),
  );
  // Strict output schemas catch a tool that starts returning a field it did
  // not declare, before it can reach the model or the client.
  const data = tool.output.parse(out.data);
  return { tool: tool.name, data, source: { ...out.source, at: now.toISOString() } };
}
