# Architecture

genui-erp has four parts: a Flutter client, a Fastify server, Postgres, and a language model the server talks to. The model never connects to the database.

## Repository

| Path | What it holds |
|---|---|
| `apps/client` | Flutter app. Riverpod state, the genui catalog adapters, the shell and conversation UI. `tool/drive.mjs` drives the web build for live checks and screenshots. |
| `apps/server` | Fastify server. Auth, tools, action handlers, the agent loop, the A2A endpoint and the model adapters. |
| `packages/erp_design` | Design tokens, theme, bundled IBM Plex fonts, the eleven catalog widgets with skeletons, golden tests. |
| `packages/catalog_schema` | Component JSON Schemas and `permissions.json`, and the generator that writes zod, Dart and `docs/permissions.md`. |
| `db` | Drizzle schema, migrations (the RLS policies are `migrations/0001_rls.sql`), the deterministic seed and the RLS tests. |
| `evals` | The eval suite, the adversarial and mutation runs, and committed results. |

## One question, end to end

1. The client sends the question as an A2A `message/stream` request with the user's JWT. The server verifies the token and loads or starts a session for that user. A context id from another user starts a fresh session.
2. The agent builds a system prompt with the role's catalog and actions, and offers the model only the tools the role holds.
3. Each tool call runs through `runTool`: permission check, input validation, `withScope` (Postgres role, tenant, user), strict output validation. The result is stored under an id such as `r1` and handed to the model as data, with long arrays trimmed.
4. The server streams a status line for each step (`Reading orders`) and a skeleton hint shaped like the components that tool usually produces.
5. The model answers with a surface spec that binds to result ids. `buildSurface` checks it against the role's catalog, checks children, actions and field names, resolves bindings, adds the Source footer and paging state, and parses the result against the wire schemas. If anything fails, the errors go back to the model, at most twice. After that the user gets fixed plain text and the raw output is appended to `evals/failures.jsonl`.
6. Every A2UI message then passes `guardMessage` on its way to the wire. A message that fails is logged and replaced with an error notice.
7. The client hands A2UI messages to genui's `SurfaceController`, which renders them with the catalog in `apps/client/lib/catalog/erp_catalog.dart`.

## UI events

Table paging and sorting, filters, action previews, confirms and cancels come back as A2UI action events in the same A2A stream. The server handles them without the model: paging re-runs the bound tool, a preview builds a ConfirmAction from the action's `prepare`, and a confirm runs the input the server stored at preview time. Follow-up chips and record links send a new question.

## State

Sessions, tool results and pending previews live in memory on the server, keyed by A2A context id and bound to the user who opened them. Everything durable is in Postgres, including the audit log.
