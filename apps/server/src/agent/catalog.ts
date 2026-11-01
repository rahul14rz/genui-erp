import type { Role } from "@genui-erp/db";
import { actionsFor } from "../actions/execute.ts";
import {
  ANNOTATED_DEFS,
  ANNOTATED_SCHEMAS,
  COMPONENTS,
  DEFS_JSON_SCHEMA,
  MODEL,
  MODEL_JSON_SCHEMAS,
  WIRE,
  type ComponentName,
} from "../generated/catalog.ts";
import { can, type Permission } from "../permissions.ts";

export const CATALOG_ID = "genui-erp.dev:catalog/v1";

export type RoleCatalog = {
  role: Role;
  /** Components the server may send to this role. */
  components: ReadonlySet<ComponentName>;
  /** Components the model may write for this role. Excludes server-only ones. */
  modelComponents: ReadonlySet<ComponentName>;
  actions: ReadonlySet<string>;
};

/** The catalog a role is allowed to see. Built per session, never sent whole. */
export function catalogFor(role: Role): RoleCatalog {
  const actions = new Set(actionsFor(role).map((a) => a.name));
  const allowed = COMPONENTS.filter((c) =>
    c.permission === null ? true : c.permission === "@action" ? actions.size > 0 : can(role, c.permission as Permission),
  );
  return {
    role,
    components: new Set(allowed.map((c) => c.name)),
    modelComponents: new Set(allowed.filter((c) => !c.serverOnly).map((c) => c.name)),
    actions,
  };
}

/** The part of the system prompt that lists components the role may use. */
export function describeCatalog(catalog: RoleCatalog): string {
  const parts = COMPONENTS.filter((c) => catalog.modelComponents.has(c.name)).map(
    (c) => `### ${c.name}\n${c.description}\n${JSON.stringify(MODEL_JSON_SCHEMAS[c.name])}`,
  );
  return `${parts.join("\n\n")}\n\n### Shared definitions\n${JSON.stringify(DEFS_JSON_SCHEMA)}`;
}

export { ANNOTATED_DEFS, ANNOTATED_SCHEMAS, MODEL, WIRE, type ComponentName };
