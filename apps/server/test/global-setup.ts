import { resetDatabase } from "@genui-erp/db/admin";
import { ADMIN_URL, ANCHOR, APP_PASSWORD } from "./harness.ts";

export default async function setup() {
  await resetDatabase({ adminUrl: ADMIN_URL, appPassword: APP_PASSWORD, anchor: ANCHOR });
}
