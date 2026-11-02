# 0003. The model binds to tool results instead of writing values

Date: 2026-11-01. Status: accepted.

## Context

Users must be able to trust the numbers. A model that copies rows into a table can drop rows, round values or invent a total. It also spends most of its output on data the server already has.

## Decision

Data-bearing props in the catalog schemas are marked `x-bindable`. The model writes `{"bind": "r1.rows"}` or `{"bind": "r2.totals.revenueCents"}`, where `r1` is the id the server gave a tool result. The server resolves bindings from the stored result before anything is sent. Field names the model chooses for columns and chart series must exist in the bound rows, or the answer is rejected and repaired.

## Consequences

- Every number on screen came from a tool result, and the Source footer names the tables and filters that produced it.
- Paging, sorting and filters re-run the bound tool on the server and resend the surface. The model is not called again.
- The model sees at most 15 rows of each result. Bindings read the full result.
- A model cannot show a field its role's tools did not return, which is a second barrier behind the column grants.
