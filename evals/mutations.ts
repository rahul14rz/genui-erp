import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Breaks one safety layer at a time, runs the suite, and restores the code.
 * Each mutation is expected to make the suite fail; one that passes means the
 * suite cannot see that layer. Writes evals/results/mutations.json.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SURFACE = join(ROOT, "apps/server/src/agent/surface.ts");
const GUARD = join(ROOT, "apps/server/src/agent/guard.ts");

type Edit = [file: string, from: string, to: string];
const validatorOff: Edit[] = [
  [SURFACE, "    if (!catalog.modelComponents.has(c.component as ComponentName)) {", "    if (false && !catalog.modelComponents.has(c.component as ComponentName)) {"],
  [SURFACE, '      if (typeof value === "string" && !catalog.actions.has(value)) {', '      if (false && typeof value === "string" && !catalog.actions.has(value)) {'],
  [
    SURFACE,
    "    const schema = MODEL[component as keyof typeof MODEL];\n    const r = schema.safeParse(props);",
    "    const schema = MODEL[component as keyof typeof MODEL] ?? { safeParse: (x: unknown) => ({ success: true, data: x }) };\n    const r = (schema as typeof MODEL.Panel).safeParse(props);",
  ],
  [SURFACE, "    const r = WIRE[component as ComponentName].safeParse(props);\n    if (!r.success)", "    const r = WIRE[component as ComponentName].safeParse(props);\n    if (false && !r.success)"],
];
const guardOff: Edit[] = [
  [GUARD, "export function guardMessage(msg: A2uiMessage, catalog: RoleCatalog): string[] {", "export function guardMessage(msg: A2uiMessage, catalog: RoleCatalog): string[] {\n  if (catalog) return [];"],
];

const scratch = mkdtempSync(join(tmpdir(), "genui-erp-mutation-"));
const brokenRls = join(scratch, "break-rls.sql");
writeFileSync(brokenRls, "drop policy rep_customers on customers;\ncreate policy rep_customers on customers for select to genui_role_sales_rep using (true);\n");

const MUTATIONS: { name: string; expectFail: boolean; edits: Edit[]; args: string[] }[] = [
  { name: "none (adversarial model, all layers on)", expectFail: false, edits: [], args: ["--provider=adversarial"] },
  { name: "validator catalog checks off, guard on", expectFail: false, edits: validatorOff, args: ["--provider=adversarial"] },
  { name: "validator catalog checks off, guard off", expectFail: true, edits: [...validatorOff, ...guardOff], args: ["--provider=adversarial"] },
  { name: "sales rep RLS policy opened up", expectFail: true, edits: [], args: [`--sql=${brokenRls}`] },
];

const results = [];
for (const m of MUTATIONS) {
  const originals = new Map<string, string>();
  for (const [file] of m.edits) if (!originals.has(file)) originals.set(file, readFileSync(file, "utf8"));
  try {
    for (const [file, from, to] of m.edits) {
      const src = readFileSync(file, "utf8");
      if (!src.includes(from)) throw new Error(`mutation "${m.name}" no longer applies to ${file}`);
      writeFileSync(file, src.replace(from, to));
    }
    let out = "";
    try {
      out = execFileSync("npx", ["tsx", "run.ts", ...m.args], { cwd: join(ROOT, "evals"), encoding: "utf8" });
    } catch (err) {
      out = (err as { stdout?: string }).stdout ?? "";
    }
    const failed = out.split("\n").filter((l) => l.startsWith("FAIL")).map((l) => l.split(/\s+/)[1]);
    const summary = out.split("\n").find((l) => l.startsWith("provider")) ?? "";
    const ok = m.expectFail ? failed.length > 0 : failed.length === 0;
    results.push({ mutation: m.name, expect: m.expectFail ? "suite fails" : "suite passes", failedCases: failed, summary, ok });
    console.log(`${ok ? "as expected" : "UNEXPECTED"}  ${m.name}: ${failed.length} failing cases`);
  } finally {
    for (const [file, src] of originals) writeFileSync(file, src);
  }
}
writeFileSync(join(ROOT, "evals/results/mutations.json"), JSON.stringify(results, null, 2));
if (results.some((r) => !r.ok)) process.exitCode = 1;
