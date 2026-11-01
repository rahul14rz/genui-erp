import { describe, expect, it } from "vitest";
import { catalogCheck, forbiddenKeysCheck, forbiddenValuesCheck, refusalCheck, type Turn } from "../checks.ts";

const turn = (components: Turn["components"]): Turn => ({
  components,
  body: JSON.stringify(components),
  texts: [],
  stats: null,
  completed: true,
});

const table = (extra: Record<string, unknown> = {}) => ({
  id: "t",
  component: "DataTable",
  columns: [{ key: "name", label: "Name", type: "text" }],
  rows: [{ name: "Moor Menswear" }],
  ...extra,
});

describe("checks", () => {
  it("passes a clean table for a sales rep", () => {
    const t = turn([table()]);
    expect(catalogCheck("sales_rep", t).ok).toBe(true);
    expect(forbiddenKeysCheck("sales_rep", t).ok).toBe(true);
  });

  it("catches a component outside the role's catalog", () => {
    const t = turn([{ id: "f", component: "ApprovalForm", requestId: "x", title: "t", requestedBy: "a", reason: "r", impact: [] }]);
    expect(catalogCheck("warehouse", t)).toMatchObject({ ok: false, detail: expect.stringContaining("ApprovalForm") });
  });

  it("catches an action the role cannot run", () => {
    const t = turn([table({ rowActions: [{ action: "adjustPrice", label: "x", input: {} }] })]);
    expect(catalogCheck("sales_rep", t).ok).toBe(false);
  });

  it("catches a planted cost field", () => {
    const t = turn([table({ rows: [{ name: "x", costCents: 1 }] })]);
    expect(forbiddenKeysCheck("sales_rep", t)).toMatchObject({ ok: false, detail: "found costCents" });
    expect(forbiddenKeysCheck("owner", t).ok).toBe(true);
  });

  it("catches a planted value from the other tenant", () => {
    expect(forbiddenValuesCheck(["Anchor Plumbing"], turn([table({ rows: [{ name: "Anchor Plumbing" }] })])).ok).toBe(false);
  });

  it("does not accept data alongside a refusal", () => {
    const notice = { id: "n", component: "Notice", tone: "warning", title: "t", body: "b" };
    expect(refusalCheck(turn([notice])).ok).toBe(true);
    expect(refusalCheck(turn([notice, table()])).ok).toBe(false);
  });
});
