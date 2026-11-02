# 0001. GenUI and A2UI versions

Date: 2026-11-01. Status: accepted.

## What I checked

Package versions come from pub.dev and npm on 2026-11-01. API details come from the published package source, not from memory or the READMEs alone.

| Package | Version | Notes |
|---|---|---|
| Flutter | 3.47.9 stable (Dart 3.13.7) | The brief asks for 3.35.7 or newer. |
| `genui` | 0.10.4 | Core framework. Supports A2UI v0.9. |
| `genui_a2a` | 0.10.1 | A2A client for genui. Replaces `genui_a2ui`, which is discontinued. |
| `a2ui_core` | 0.1.1 | Pinned to the version `genui` 0.10.4 resolves. 0.4.0 exists but `genui` does not accept it yet. |
| `json_schema_builder` | 0.1.7 | Pinned to the version `genui` resolves. Needed to give each catalog item its schema. |
| `a2ui_flutter`, `a2ui_agent` | 0.0.1-wip003, 0.0.1-wip004 | Not used. See below. |

The A2UI version is v0.9. `genui_a2a` sends the extension header `X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v0.9`, and every A2UI message carries `"version": "v0.9"`.

## Decision

Use `genui` 0.10.4 and `genui_a2a` 0.10.1, pinned exactly.

The genui README says the SDK is being split into `a2ui_core`, `a2ui_agent` and `a2ui_flutter`, with a different API. Those packages are work-in-progress releases. Building on them now would mean rewriting the client when they stabilise. Revisit this when `a2ui_flutter` reaches a non-wip release.

## Where the docs and the code disagree

- The `genui_a2a` README says the connector uses a WebSocket. The 0.10.1 source uses JSON-RPC 2.0 over HTTP, with `message/stream` answered as server-sent events. The server follows the source.
- `A2uiAgentConnector` builds its own transport with only the extension header, so it cannot send a bearer token. It also forwards only text and data parts and drops message metadata. The client therefore uses `A2AClient` with an `SseTransport` that carries both headers, and parses the stream itself. `SseTransport` is not exported from `genui_a2a`'s public library, so `lib/agent/connection.dart` imports it from `src/`. That import will break on a package restructure, which is the cost of sending auth.
- The brief describes the server as speaking A2A. The A2A JS SDK (`@a2a-js/sdk`) targets Express. The server implements the three endpoints the client calls (agent card, `message/stream`, `message/send`) directly in Fastify, so every outgoing message passes through one guard function.

## Consequences

- Status lines travel as a data part `{"erpStatus": "..."}` and skeleton hints as `{"erpPending": {...}}`. Any A2UI client that ignores unknown data parts still works, but only this client shows them.
- User actions from surfaces (paging, filters, previews, confirms) go back as A2UI v0.9 action events in a data part over `message/stream`. The server handles them without calling the model.
