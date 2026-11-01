export const TEST_ANCHOR = new Date("2026-06-30T00:00:00Z");
export const TEST_ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/genui_erp_test";
// Roles are cluster-wide, so tests and local dev must agree on this password.
export const TEST_APP_PASSWORD = process.env.GENUI_APP_PASSWORD ?? "genui_app_local";
export const TEST_APP_URL = (() => {
  const u = new URL(TEST_ADMIN_URL);
  u.username = "genui_app";
  u.password = TEST_APP_PASSWORD;
  return u.toString();
})();
