import { createPool } from "@genui-erp/db";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = buildApp({ config, pool, logger: true });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(`server listening on :${config.port}`);
