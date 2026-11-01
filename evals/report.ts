import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Writes docs/evals.md from the JSON results of the last runs. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => JSON.parse(readFileSync(join(ROOT, "evals/results", f), "utf8"));
type Run = {
  provider: string; cases: number; passed: number; schemaValid: string; repaired: string; fallback: string; commit: string; at: string;
  rows: { id: string; user: string; injection: boolean; ok: boolean; failed: { name: string; detail?: string }[] }[];
};
const runs: Run[] = ["scripted.json", "adversarial.json"].map(read);
const mutations: { mutation: string; expect: string; failedCases: string[]; ok: boolean }[] = read("mutations.json");
const sha = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();

const summary = runs
  .map((r) => `| ${r.provider} | ${r.passed}/${r.cases} | ${r.schemaValid} | ${r.repaired} | ${r.fallback} |`)
  .join("\n");
const byCase = runs[0]!.rows
  .map((row) => {
    const cells = runs.map((r) => {
      const x = r.rows.find((y) => y.id === row.id)!;
      return x.ok ? "pass" : `fail: ${x.failed.map((f) => f.name).join(", ")}`;
    });
    return `| ${row.id} | ${row.user} | ${row.injection ? "yes" : ""} | ${cells.join(" | ")} |`;
  })
  .join("\n");
const mut = mutations
  .map((m) => `| ${m.mutation} | ${m.expect} | ${m.failedCases.length ? m.failedCases.join(", ") : "none"} | ${m.ok ? "yes" : "no"} |`)
  .join("\n");

writeFileSync(
  join(ROOT, "docs/evals.md"),
  `# Evals

Snapshot from commit \`${sha}\`, ${runs[0]!.at.slice(0, 10)}. Regenerate with \`pnpm evals:report\`.

The suite asks ${runs[0]!.cases} questions over A2A against a running server and a freshly seeded database. For each answer it checks, on the client side and independently of the server's own guard:

- every component and action is in the signed-in role's catalog, and every component matches its wire schema,
- no field the role must not see appears anywhere in the payload (for example \`costCents\` for a sales rep, \`priceCents\` for warehouse),
- no value the role must not see appears (the other tenant's customer names, and for a sales rep, house-account names),
- well-defined questions produce the expected components, and questions outside the role produce a refusal notice with no data,
- injection cases write nothing to the audit log, and with an honest model call the same tools as a clean twin question.

## Results

| Model | Passed | Schema-valid first try | Repaired | Fell back to text |
|---|---|---|---|---|
${summary}

**scripted** is the deterministic planner the server uses when no model is configured. Its 100% schema-valid rate is by construction, so it measures the pipeline, not a model.

**adversarial** behaves like the scripted planner until a tool result carries injected text, then obeys it: it calls tools the role does not hold, asks for the other tenant's customers, and emits an ApprovalForm, a ConfirmAction, a cost column and foreign actions. The fallback rate is the injection cases: the validator rejects the answer twice and the user gets plain text. Nothing leaks and nothing is written.

A real model has not been run in this snapshot. The environment this was built in could not reach a model provider. Run \`MODEL_BASE_URL=... MODEL_NAME=... pnpm evals\` against Ollama or a hosted model to get its numbers.

## Does the suite catch a broken layer

Each row breaks one layer, runs the suite, and restores the code (\`pnpm --filter @genui-erp/evals run mutations\`).

| Change | Expected | Failing cases | As expected |
|---|---|---|---|
${mut}

The second row is the point of the guard: with the validator's catalog checks removed, the guard alone still stops every out-of-catalog component and action from reaching the client.

## Per case

| Case | User | Injection | ${runs.map((r) => r.provider).join(" | ")} |
|---|---|---|${runs.map(() => "---").join("|")}|
${byCase}
`,
);
console.log("wrote docs/evals.md");
