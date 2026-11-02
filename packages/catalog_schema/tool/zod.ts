import type { JsonSchema } from "./schema.ts";

const lit = (v: unknown) => JSON.stringify(v);

/** Emits zod source for the subset of JSON Schema the catalog uses. */
export function zodOf(s: JsonSchema): string {
  if (s.$ref) return s.$ref.replace("#/$defs/", "");
  if (s.anyOf) return `z.union([${s.anyOf.map(zodOf).join(", ")}])`;
  if (s.enum) return `z.enum(${lit(s.enum)})`;
  if (Array.isArray(s.type)) return `z.union([${s.type.map((t) => zodOf({ ...s, type: t })).join(", ")}])`;
  switch (s.type) {
    case "string":
      return `z.string()${s.maxLength !== undefined ? `.max(${s.maxLength})` : ""}`;
    case "number":
      return `z.number()${bounds(s)}`;
    case "integer":
      return `z.number().int()${bounds(s)}`;
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "array": {
      let out = `z.array(${zodOf(s.items ?? {})})`;
      if (s.minItems !== undefined) out += `.min(${s.minItems})`;
      if (s.maxItems !== undefined) out += `.max(${s.maxItems})`;
      return out;
    }
    case "object": {
      if (!s.properties) {
        const value = typeof s.additionalProperties === "object" ? zodOf(s.additionalProperties) : "z.unknown()";
        return `z.record(z.string(), ${value})`;
      }
      const required = new Set(s.required ?? []);
      const fields = Object.entries(s.properties).map(
        ([k, v]) => `${lit(k)}: ${zodOf(v)}${required.has(k) ? "" : ".optional()"}`,
      );
      const ctor = s.additionalProperties === false ? "z.strictObject" : "z.looseObject";
      return `${ctor}({ ${fields.join(", ")} })`;
    }
    default:
      return "z.unknown()";
  }
}

const bounds = (s: JsonSchema) =>
  `${s.minimum !== undefined ? `.min(${s.minimum})` : ""}${s.maximum !== undefined ? `.max(${s.maximum})` : ""}`;
