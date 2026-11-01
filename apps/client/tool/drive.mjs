// Drives the Flutter web build through its accessibility tree, for live checks
// and screenshots. Steps come from a JSON file:
//   node tool/drive.mjs steps.json
// {"url": "http://localhost:8080/", "width": 1280, "height": 900, "scheme": "light",
//  "steps": [["login", "warehouse@northfield.test"], ["ask", "..."], ["click", "Mark dispatched"],
//            ["fill", "Carrier", "Royal Parcel"], ["press", "Control+k"], ["wait", 1000],
//            ["shot", "out.png"], ["expectText", "Change saved"]]}
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: plan.width ?? 1280, height: plan.height ?? 900 },
  colorScheme: plan.scheme ?? "light",
  reducedMotion: plan.reducedMotion ? "reduce" : "no-preference",
});
const errors = [];
const external = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.route("**/*", (route) => {
  const host = new URL(route.request().url()).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    external.push(route.request().url());
    return route.abort();
  }
  return route.continue();
});

// Flutter merges some texts into one aria-label, so look in both places.
const textCount = async (text) =>
  (await page.getByText(text).count()) + (await page.locator(`[aria-label*=${JSON.stringify(text)}]`).count());
const enableSemantics = () => page.evaluate(() => document.querySelector("flt-semantics-placeholder")?.click());
const results = [];
try {
  await page.goto(plan.url ?? "http://localhost:8080/");
  await page.waitForTimeout(2500);
  await enableSemantics();
  await page.waitForTimeout(400);
  for (const [op, a, b] of plan.steps) {
    switch (op) {
      case "login": {
        // Uses the demo account buttons, which sign in with the seeded password.
        const [user, domain] = a.split("@");
        const role = { owner: "Owner", salesrep: "Sales rep", warehouse: "Warehouse", accounts: "Accounts" }[user];
        const tenant = domain.startsWith("northfield") ? "Northfield Textiles" : "Coastline Hardware";
        await page.getByRole("button", { name: `Sign in as ${role} at ${tenant}` }).click();
        await page.getByRole("textbox").last().waitFor();
        await page.waitForTimeout(800);
        break;
      }
      case "ask": {
        const box = page.getByRole("textbox").last();
        await box.fill(a);
        await box.press("Enter");
        await page.waitForTimeout(b ?? 3000);
        break;
      }
      case "click":
        await page.getByRole("button", { name: a, exact: true }).nth(b ?? 0).click();
        await page.waitForTimeout(1200);
        break;
      case "clickText":
        await page.getByText(a, { exact: true }).nth(b ?? 0).click();
        await page.waitForTimeout(1200);
        break;
      case "fill":
        await page.getByRole("textbox").nth(Number(a)).fill(b);
        break;
      case "press":
        await page.keyboard.press(a);
        await page.waitForTimeout(b ?? 400);
        break;
      case "type":
        await page.keyboard.type(a);
        break;
      case "wait":
        await page.waitForTimeout(a);
        break;
      case "scroll":
        await page.mouse.move(640, 400);
        await page.mouse.wheel(0, a);
        await page.waitForTimeout(500);
        break;
      case "shot":
        await page.screenshot({ path: a, fullPage: false });
        results.push({ shot: a });
        break;
      case "expectText": {
        const n = await textCount(a);
        results.push({ expectText: a, found: n > 0 });
        if (n === 0) throw new Error(`expected text not found: ${a}`);
        break;
      }
      case "expectNoText": {
        const n = await textCount(a);
        results.push({ expectNoText: a, found: n > 0 });
        if (n > 0) throw new Error(`unexpected text found: ${a}`);
        break;
      }
      case "focused": {
        const role = await page.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.getAttribute("aria-label") ?? ""));
        results.push({ focused: role });
        break;
      }
      default:
        throw new Error(`unknown step ${op}`);
    }
  }
  console.log(JSON.stringify({ ok: true, results, errors, external }));
} catch (err) {
  await page.screenshot({ path: "/tmp/drive-failure.png" }).catch(() => {});
  console.log(JSON.stringify({ ok: false, error: String(err), results, errors, external }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
