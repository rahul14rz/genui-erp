import { z } from "zod";
import type { Source } from "../tools/types.ts";
import { ANNOTATED_DEFS, ANNOTATED_SCHEMAS, MODEL, WIRE, type ComponentName, type RoleCatalog } from "./catalog.ts";

/** One tool result held for the session. The model refers to it by id. */
export type StoredResult = { id: string; tool: string; input: Record<string, unknown>; data: unknown; source: Source };

export type ComponentSpec = { id: string; component: string; [prop: string]: unknown };
export type SurfaceSpec = { components: ComponentSpec[] };

export const ModelAnswer = z.object({
  say: z.string().max(600).optional(),
  surface: z.object({
    components: z
      .array(z.looseObject({ id: z.string().min(1).max(40), component: z.string() }))
      .min(1)
      .max(12),
  }),
});
export type ModelAnswer = z.infer<typeof ModelAnswer>;

type Annotated = {
  $ref?: string;
  type?: string;
  properties?: Record<string, Annotated>;
  items?: Annotated;
  "x-field"?: boolean;
  "x-action"?: boolean;
  "x-bindable"?: boolean;
};
const deref = (s: Annotated): Annotated =>
  s.$ref ? ((ANNOTATED_DEFS as Record<string, Annotated>)[s.$ref.replace("#/$defs/", "")] ?? s) : s;

/** Every value at a path whose schema carries the given annotation. */
function annotated(schema: Annotated, value: unknown, flag: "x-field" | "x-action", path = ""): { path: string; value: unknown }[] {
  const s = deref(schema);
  if (s[flag]) return [{ path, value }];
  if (s.properties && value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(s.properties).flatMap(([k, sub]) =>
      k in (value as object) ? annotated(sub, (value as Record<string, unknown>)[k], flag, `${path}.${k}`) : [],
    );
  }
  if (s.items && Array.isArray(value)) return value.flatMap((v, i) => annotated(s.items!, v, flag, `${path}[${i}]`));
  return [];
}

const isBinding = (v: unknown): v is { bind: string } =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { bind?: unknown }).bind === "string";

function lookup(results: Map<string, StoredResult>, ref: string): { ok: true; value: unknown; result: StoredResult } | { ok: false; error: string } {
  const [id, ...path] = ref.split(".");
  const result = results.get(id ?? "");
  if (!result) return { ok: false, error: `binding "${ref}" names result "${id}", which does not exist` };
  let v: unknown = result.data;
  for (const key of path) {
    if (v && typeof v === "object" && key in (v as object)) v = (v as Record<string, unknown>)[key];
    else return { ok: false, error: `binding "${ref}" has no field "${key}" in result ${id}` };
  }
  return { ok: true, value: v, result };
}

/** Replaces every {"bind": ...} with the referenced value. Records which results were used. */
function resolve(value: unknown, results: Map<string, StoredResult>, used: Set<string>, errors: string[], at: string): unknown {
  if (isBinding(value)) {
    const r = lookup(results, value.bind);
    if (!r.ok) {
      errors.push(`${at}: ${r.error}`);
      return null;
    }
    used.add(r.result.id);
    return r.value;
  }
  if (Array.isArray(value)) return value.map((v, i) => resolve(v, results, used, errors, `${at}[${i}]`));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, results, used, errors, `${at}.${k}`)]));
  }
  return value;
}

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

export type Built = {
  components: ComponentSpec[];
  /** Result ids each component reads from, for paging and filters. */
  bindings: Map<string, string[]>;
};

/**
 * Checks a model answer against the role's catalog and turns it into wire
 * components. Errors are written for the model, so a repair pass can fix them.
 */
export function buildSurface(
  answer: ModelAnswer,
  catalog: RoleCatalog,
  results: Map<string, StoredResult>,
): { ok: true; built: Built } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const specs = answer.surface.components as ComponentSpec[];
  const ids = new Set<string>();
  for (const c of specs) {
    if (ids.has(c.id)) errors.push(`component id "${c.id}" is used twice`);
    ids.add(c.id);
    if (!catalog.modelComponents.has(c.component as ComponentName)) {
      errors.push(`component "${c.component}" (id ${c.id}) is not available to this user. Use only: ${[...catalog.modelComponents].join(", ")}`);
    }
  }
  const root = specs.find((c) => c.id === "root");
  if (!root || root.component !== "Panel") errors.push('the surface needs one component with id "root" and component "Panel"');
  if (errors.length) return { ok: false, errors };

  const parsedModel = new Map<string, Record<string, unknown>>();
  for (const c of specs) {
    const { id, component, ...props } = c;
    const schema = MODEL[component as keyof typeof MODEL];
    const r = schema.safeParse(props);
    if (!r.success) errors.push(...issues(r.error).map((m) => `${component} ${id}: ${m}`));
    else parsedModel.set(id, r.data as Record<string, unknown>);
  }
  if (errors.length) return { ok: false, errors };

  const children = (parsedModel.get("root")?.children as string[]) ?? [];
  const reachable = new Set(["root", ...children]);
  for (const ch of children) {
    if (!ids.has(ch)) errors.push(`Panel root lists child "${ch}", which is not defined`);
    if (ch === "root") errors.push("Panel root cannot contain itself");
  }
  for (const c of specs) {
    if (c.component === "Panel" && c.id !== "root") errors.push(`only the root may be a Panel (found ${c.id})`);
    if (!reachable.has(c.id)) errors.push(`component "${c.id}" is not listed in root.children`);
  }

  const wire: ComponentSpec[] = [];
  const bindings = new Map<string, string[]>();
  for (const c of specs) {
    const used = new Set<string>();
    const props = resolve(parsedModel.get(c.id), results, used, errors, `${c.component} ${c.id}`) as Record<string, unknown>;
    bindings.set(c.id, [...used]);

    for (const { path, value } of annotated(ANNOTATED_SCHEMAS[c.component] as Annotated, props, "x-action")) {
      if (typeof value === "string" && !catalog.actions.has(value)) {
        errors.push(`${c.component} ${c.id}${path}: action "${value}" is not available to this user`);
      }
    }
    // Field names must exist in the rows they point at, so a column cannot
    // show a value the tool did not return.
    const rows = Array.isArray(props?.rows) ? (props.rows as Record<string, unknown>[]) : null;
    if (rows && rows.length > 0) {
      const keys = new Set(rows.flatMap((r) => Object.keys(r)));
      for (const { path, value } of annotated(ANNOTATED_SCHEMAS[c.component] as Annotated, props, "x-field")) {
        if (typeof value === "string" && !keys.has(value)) {
          errors.push(`${c.component} ${c.id}${path}: field "${value}" is not in the bound rows. Available: ${[...keys].join(", ")}`);
        }
      }
    }
    wire.push({ id: c.id, component: c.component, ...props });
  }
  if (errors.length) return { ok: false, errors };

  const usedResults = new Set([...bindings.values()].flat());
  for (const w of wire) {
    if (w.component === "Panel") {
      w.source = [...usedResults].map((id) => results.get(id)!.source);
      if ((w.source as unknown[]).length === 0) delete w.source;
    }
    if (w.component === "DataTable") decorateTable(w, bindings.get(w.id) ?? [], results);
  }
  for (const w of wire) {
    const { id, component, ...props } = w;
    const r = WIRE[component as ComponentName].safeParse(props);
    if (!r.success) errors.push(...issues(r.error).map((m) => `${component} ${id}: ${m}`));
  }
  return errors.length ? { ok: false, errors } : { ok: true, built: { components: wire, bindings } };
}

/** Server-owned paging and sort state, read from the tool input that produced the rows. */
export const SORTABLE: Record<string, Record<string, string>> = {
  listOrders: { orderedAt: "orderedAt", requiredBy: "requiredBy", valueCents: "value" },
};

function decorateTable(w: ComponentSpec, used: string[], results: Map<string, StoredResult>) {
  const result = used.length === 1 ? results.get(used[0]!) : undefined;
  const input = result?.input ?? {};
  const sortable = SORTABLE[result?.tool ?? ""] ?? {};
  w.columns = (w.columns as { key: string }[]).map((c) => ({ ...c, sortable: c.key in sortable }));
  if (typeof input.limit === "number") w.pageSize = input.limit;
  if (typeof input.offset === "number") w.offset = input.offset;
  const data = result?.data as { total?: unknown } | undefined;
  if (typeof data?.total === "number") w.total = data.total;
  if (typeof input.sort === "string") {
    const key = Object.entries(sortable).find(([, v]) => v === input.sort)?.[0];
    if (key) w.sort = { key, direction: input.direction === "asc" ? "asc" : "desc" };
  }
}
