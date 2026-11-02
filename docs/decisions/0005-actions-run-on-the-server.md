# 0005. Writes go through preview, server-held input and an idempotency key

Date: 2026-11-01. Status: accepted.

## Context

Write actions (dispatch, adjust stock, approve, record payment) must show exactly what will change, must not trust the client to show only allowed buttons, and must be safe to retry.

## Decision

- Each action has one `prepare` function that reads what the write needs and returns both the preview and the function that applies it. The preview cannot drift from the write.
- A preview request re-checks the permission and returns a ConfirmAction surface with an idempotency key the server generated. The server stores the action and input under that key.
- Confirm sends only the key. The server runs the input it stored, so a tampered confirm cannot change what runs.
- The run checks the permission again, runs in one transaction, and writes the audit row in the same transaction. A repeated key returns the stored result. The same key with different input is a conflict. Denied and invalid attempts are audited too.
- After a successful write, the server re-runs the tool results the action made stale and resends those surfaces.

## Consequences

- The model never runs an action. It can only place an action reference in a table row, which the guard checks against the role's actions.
- Pending previews live in the in-memory session, so they expire with it.
