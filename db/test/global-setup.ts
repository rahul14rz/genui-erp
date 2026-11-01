import { resetDatabase } from "../src/admin.ts";
import { TEST_ADMIN_URL, TEST_ANCHOR, TEST_APP_PASSWORD } from "./env.ts";

export default async function setup() {
  await resetDatabase({ adminUrl: TEST_ADMIN_URL, appPassword: TEST_APP_PASSWORD, anchor: TEST_ANCHOR });
}
