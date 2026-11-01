// Measures time to the first status line and the first surface over A2A,
// using whatever model the server runs. Usage: node first-surface.mjs [runs]
const api = process.env.API_URL ?? "http://127.0.0.1:8787";
const runs = Number(process.argv[2] ?? 50);
const questions = [
  ["warehouse@northfield.test", "which orders are stuck in dispatch this week?"],
  ["owner@northfield.test", "show sales by month"],
  ["accounts@coastline.test", "which invoices are overdue?"],
  ["salesrep@coastline.test", "show my recent orders"],
];
const login = async (email) =>
  (await (await fetch(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "genui-erp-local" }) })).json()).token;
const tokens = Object.fromEntries(await Promise.all(questions.map(async ([e]) => [e, await login(e)])));
const status = [];
const surface = [];
for (let i = 0; i < runs; i++) {
  const [email, text] = questions[i % questions.length];
  const t0 = performance.now();
  const res = await fetch(`${api}/a2a`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens[email]}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/stream", params: { message: { messageId: `b${i}`, role: "user", parts: [{ kind: "text", text }] } } }),
  });
  let buf = "";
  let sawStatus = false;
  let sawSurface = false;
  for await (const chunk of res.body) {
    buf += new TextDecoder().decode(chunk);
    if (!sawStatus && buf.includes("erpStatus")) (sawStatus = true), status.push(performance.now() - t0);
    if (!sawSurface && buf.includes("updateComponents")) (sawSurface = true), surface.push(performance.now() - t0);
  }
}
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))].toFixed(1);
console.log(JSON.stringify({ runs, firstStatusMs: { p50: pct(status, 0.5), p95: pct(status, 0.95) }, firstSurfaceMs: { p50: pct(surface, 0.5), p95: pct(surface, 0.95) } }));
