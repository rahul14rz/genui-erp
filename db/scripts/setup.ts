import { setupDatabase } from "../src/admin.ts";

const adminUrl = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/genui_erp";
const appPassword = process.env.GENUI_APP_PASSWORD ?? "genui_app_local";
const outcome = await setupDatabase({ adminUrl, appPassword, anchor: new Date() });
console.log(outcome === "seeded" ? "database migrated and seeded" : "database migrated, existing data kept");
