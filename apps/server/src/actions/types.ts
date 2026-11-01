import type { Scope, ScopedDb } from "@genui-erp/db";
import { z } from "zod";
import type { Permission } from "../permissions.ts";

export type Change = {
  entity: string;
  label: string;
  field: string;
  from: string | number | null;
  to: string | number | null;
};

/** What a write will do, shown to the user in ConfirmAction before it runs. */
export type Preview = { title: string; summary: string; changes: Change[] };

export type ActionContext = { db: ScopedDb; scope: Scope; now: Date };

/**
 * `prepare` reads everything the write needs and returns the preview together
 * with the function that applies it, so the preview cannot drift from the
 * write it describes.
 */
export type Action<I extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  permission: Permission;
  input: I;
  prepare: (
    ctx: ActionContext,
    input: z.infer<I>,
  ) => Promise<{ preview: Preview; apply: () => Promise<Record<string, unknown>> }>;
};

export const defineAction = <I extends z.ZodType>(a: Action<I>): Action<I> => a;
