import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  description?: string;
  title?: string;
  "x-bindable"?: boolean;
  "x-field"?: boolean;
  "x-action"?: boolean;
  "x-children"?: boolean;
  "x-server"?: boolean;
  "x-permission"?: string | null;
  "x-server-only"?: boolean;
  [k: string]: unknown;
};

export type Component = {
  name: string;
  description: string;
  permission: string | null;
  serverOnly: boolean;
  schema: JsonSchema;
};

export type Catalog = { defs: Record<string, JsonSchema>; components: Component[] };

export const BINDING: JsonSchema = {
  type: "object",
  description: "Reads a value from a tool result, for example {\"bind\": \"r1.rows\"} or {\"bind\": \"r1.totals.revenueCents\"}.",
  properties: { bind: { type: "string" } },
  required: ["bind"],
  additionalProperties: false,
};

export function loadCatalog(dir: string, permissions: Set<string>): Catalog {
  const defs = (JSON.parse(readFileSync(join(dir, "_defs.json"), "utf8")) as { $defs: Record<string, JsonSchema> }).$defs;
  const components = readdirSync(dir)
    .filter((f) => f.endsWith(".schema.json"))
    .sort()
    .map((f) => {
      const schema = JSON.parse(readFileSync(join(dir, f), "utf8")) as JsonSchema;
      const name = f.replace(".schema.json", "");
      if (schema.title !== name) throw new Error(`${f}: title must be ${name}`);
      if (!("x-permission" in schema)) throw new Error(`${f}: x-permission is required, use null for any signed-in user`);
      const permission = schema["x-permission"] ?? null;
      if (permission !== null && permission !== "@action" && !permissions.has(permission)) {
        throw new Error(`${f}: unknown permission ${permission}`);
      }
      return {
        name,
        description: schema.description ?? "",
        permission,
        serverOnly: schema["x-server-only"] === true,
        schema,
      };
    });
  return { defs, components };
}

/**
 * The schema the model writes against. Bindable properties also accept a
 * binding, and properties the server fills in are removed.
 */
export function modelSchema(s: JsonSchema): JsonSchema {
  const walk = (node: JsonSchema): JsonSchema => {
    const out: JsonSchema = { ...node };
    if (node.properties) {
      out.properties = Object.fromEntries(
        Object.entries(node.properties)
          .filter(([, v]) => !v["x-server"])
          .map(([k, v]) => [k, walk(v)]),
      );
      if (node.required) out.required = node.required.filter((k) => !node.properties![k]!["x-server"]);
    }
    if (node.items) out.items = walk(node.items);
    if (node["x-bindable"]) {
      const { "x-bindable": _b, description, ...rest } = out;
      return { ...(description ? { description } : {}), anyOf: [rest, { $ref: "#/$defs/Binding" }] };
    }
    return out;
  };
  return walk(s);
}

/** Drops the x- annotations and inlines nothing, for describing a schema to a model. */
export function stripAnnotations(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(stripAnnotations);
  if (s && typeof s === "object") {
    return Object.fromEntries(
      Object.entries(s)
        .filter(([k]) => !k.startsWith("x-") && k !== "$comment")
        .map(([k, v]) => [k, stripAnnotations(v)]),
    );
  }
  return s;
}
