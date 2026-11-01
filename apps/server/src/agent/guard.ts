import { CATALOG_ID, WIRE, type ComponentName, type RoleCatalog } from "./catalog.ts";

export type A2uiMessage =
  | { version: "v0.9"; createSurface: { surfaceId: string; catalogId: string } }
  | { version: "v0.9"; updateComponents: { surfaceId: string; components: { id: string; component: string; [k: string]: unknown }[] } }
  | { version: "v0.9"; deleteSurface: { surfaceId: string } };

/** Names in every ActionRef and ConfirmAction, wherever they sit in the props. */
const actionNames = (v: unknown): string[] => {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (typeof o.action === "string") out.push(o.action);
      Object.values(o).forEach(walk);
    }
  };
  walk(v);
  return out;
};

/**
 * The last check before anything reaches the client. Every A2UI message the
 * server writes, model-built or not, passes through here. Returns the reasons
 * a message must not be sent, or an empty list.
 */
export function guardMessage(msg: A2uiMessage, catalog: RoleCatalog): string[] {
  if ("createSurface" in msg) {
    return msg.createSurface.catalogId === CATALOG_ID ? [] : [`unknown catalog ${msg.createSurface.catalogId}`];
  }
  if ("deleteSurface" in msg) return [];
  const errors: string[] = [];
  for (const c of msg.updateComponents.components) {
    const name = c.component as ComponentName;
    if (!(name in WIRE) || !catalog.components.has(name)) {
      errors.push(`component ${c.component} is not in the ${catalog.role} catalog`);
      continue;
    }
    const { id: _id, component: _c, ...props } = c;
    const parsed = WIRE[name].safeParse(props);
    if (!parsed.success) errors.push(`${name} ${c.id} does not match its schema`);
    for (const a of actionNames(props)) {
      if (!catalog.actions.has(a)) errors.push(`${name} ${c.id} references action ${a}, which ${catalog.role} cannot run`);
    }
  }
  return errors;
}
