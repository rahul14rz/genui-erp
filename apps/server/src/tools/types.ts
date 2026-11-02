import type { Role, ScopedDb, Scope } from "@genui-erp/db";
import { z } from "zod";
import type { Permission } from "../permissions.ts";

/** Where a result came from. Shown under every surface as its Source footer. */
export type Source = { tables: string[]; filters: Record<string, string>; at: string };

export type ToolContext = {
  db: ScopedDb;
  scope: Scope;
  can: (p: Permission) => boolean;
  now: Date;
};

export type ToolOutput<O> = { data: O; source: Omit<Source, "at"> };

export type Tool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  permission: Permission;
  input: I;
  output: O;
  run: (ctx: ToolContext, input: z.infer<I>) => Promise<ToolOutput<z.infer<O>>>;
};

export const defineTool = <I extends z.ZodType, O extends z.ZodType>(t: Tool<I, O>): Tool<I, O> => t;

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const page = {
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
};
export const daysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
export const filtersOf = (input: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(input)
      .filter(([k, v]) => v !== undefined && k !== "limit" && k !== "offset")
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]),
  );

export type { Role };
