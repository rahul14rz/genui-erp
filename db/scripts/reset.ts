import { resetDatabase } from "../src/admin.ts";

const adminUrl = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/genui_erp";
const appPassword = process.env.GENUI_APP_PASSWORD ?? "genui_app_local";
const anchorArg = process.argv.find((a) => a.startsWith("--anchor="))?.slice("--anchor=".length);
const anchor = anchorArg ? new Date(`${anchorArg}T00:00:00Z`) : new Date();

const started = Date.now();
await resetDatabase({ adminUrl, appPassword, anchor });
console.log(`database reset and seeded (anchor ${anchor.toISOString().slice(0, 10)}) in ${Date.now() - started} ms`);
