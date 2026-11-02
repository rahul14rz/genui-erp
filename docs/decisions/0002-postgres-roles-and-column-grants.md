# 0002. Per-role Postgres roles, RLS and column grants

Date: 2026-11-01. Status: accepted.

## Context

The brief asks for every query to run with `app.tenant_id` and `app.user_role` set, and for RLS to do the filtering, so a bug in the agent layer cannot leak another tenant's rows. Roles also differ in which columns they may see: a sales rep must not see cost, warehouse must not see prices. RLS filters rows only.

## Decision

- The server logs in as `genui_app`, which owns nothing, has no table privileges and has `NOINHERIT`. It can only `SET ROLE` to one of four roles, one per application role.
- `withScope` in `db/src/index.ts` is the only way application code reaches the database. It opens a transaction, runs `SET LOCAL ROLE`, and sets the three `app.*` settings with `set_config(..., true)`, so nothing survives the transaction on a pooled connection.
- Tenant isolation is a `RESTRICTIVE` policy on every table, so no permissive policy can widen it. Every table also has `FORCE ROW LEVEL SECURITY`.
- Row rules per role are permissive policies on the role's Postgres role, for example sales reps see only customers whose `owner_user_id` is them.
- Hidden columns are hidden with column grants. A tool that selects a column the role cannot read gets a permission error from Postgres, not a silent leak.
- Login needs to read a password hash before any tenant is known. It goes through one `SECURITY DEFINER` function, `auth_lookup(email)`, and nothing else can read `users.password_hash`.

## Rejected

- One application role with views per role. Views need their own `security_invoker` handling, multiply with every table, and a missed view leaks a column.
- Filtering in the TypeScript query layer. That is exactly the layer the brief says must not be trusted.

## Consequences

- Tools must select explicit columns, and must add price or margin columns only when the role holds the matching permission. The database enforces this, and the contract tests check it.
- Postgres roles are cluster-wide, so tests and local development share the `genui_app` password.
