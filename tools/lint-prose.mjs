// Enforces the writing rules on every tracked text file: no marketing words,
// no emojis, no exclamation marks in docs, and no tool attribution.
// Usage: node tools/lint-prose.mjs [files...]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BANNED = [
  "seamless", "robust", "leverage", "empower", "elevate", "unlock", "cutting-edge", "revolutionize",
  "revolutionise", "delve", "comprehensive", "powerful", "effortless", "game-changer", "next-generation",
  "supercharge", "journey", "in today's world",
];
const ATTRIBUTION = /co-authored-by|generated with \[|\bclaude\b|anthropic|chatgpt|openai codex/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const SKIP = /(^|\/)(LICENSE|OFL\.txt|pnpm-lock\.yaml|pubspec\.lock)$|\.(png|ttf|otf|ico|jar|lock)$|^tools\/lint-prose\.mjs$|\/meta\/.*\.json$/;
const TEXT = /\.(md|ts|mjs|cjs|dart|yaml|yml|json|sql|html|txt)$|(^|\/)Dockerfile$/;

const files = process.argv.length > 2 ? process.argv.slice(2) : execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const problems = [];
for (const file of files) {
  if (SKIP.test(file) || !TEXT.test(file)) continue;
  let inFence = false;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const at = `${file}:${i + 1}`;
      const lower = line.toLowerCase();
      for (const w of BANNED) if (new RegExp(`\\b${w}\\b`).test(lower)) problems.push(`${at}: banned word "${w}"`);
      if (EMOJI.test(line)) problems.push(`${at}: emoji`);
      if (ATTRIBUTION.test(line)) problems.push(`${at}: tool attribution`);
      if (file.endsWith(".md")) {
        if (line.trim().startsWith("```")) inFence = !inFence;
        const prose = inFence ? "" : line.replace(/`[^`]*`/g, "").replace(/!\[/g, "").replace(/<!--.*?-->/g, "");
        if (/!(\s|$)/.test(prose)) problems.push(`${at}: exclamation mark`);
      }
    });
}
for (const p of problems) console.error(p);
console.log(`${problems.length} prose problems`);
process.exit(problems.length ? 1 : 0);
