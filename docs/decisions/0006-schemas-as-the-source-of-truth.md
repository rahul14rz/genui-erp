# 0006. Component schemas are JSON Schema, generated into zod and Dart

Date: 2026-11-01. Status: accepted.

## Context

The brief asks for one place where component schemas live, generated into TypeScript and Dart so they cannot drift.

## Decision

`packages/catalog_schema/components/*.schema.json` and `permissions.json` are the sources. `tool/generate.ts` writes:

- `apps/server/src/generated/catalog.ts`: zod schemas for the wire shape and the model-facing shape (with bindings), plus JSON Schema for the system prompt,
- `apps/server/src/generated/permissions.ts`,
- `packages/erp_design/lib/src/catalog/generated.dart`: immutable Dart models with `fromJson`, and each component's JSON Schema for its genui `CatalogItem`,
- `docs/permissions.md`.

`pnpm --filter @genui-erp/catalog-schema run check` regenerates in memory and fails if any output differs from the committed file.

## Rejected

- A runtime JSON Schema validator on the server, such as Ajv. It is a new dependency, and the brief asks for zod.
- Writing the schemas in zod and exporting JSON Schema. Dart would still need a generator, and the source would live in one of the two languages.

## Consequences

The generator handles the subset of JSON Schema the catalog uses. A new keyword in a schema needs a line in `tool/zod.ts` and `tool/dart.ts`.
