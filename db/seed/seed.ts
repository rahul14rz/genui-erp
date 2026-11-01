import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as s from "../src/schema.ts";
import { hashPassword } from "../src/password.ts";
import { generate, LOCAL_PASSWORD, type Dataset } from "./generate.ts";

const CHUNK = 1000;

/** Inserts the generated dataset. Runs as the admin connection, outside RLS. */
export async function seed(pool: pg.Pool, anchor: Date): Promise<Dataset> {
  const data = generate(anchor);
  const db = drizzle(pool);
  const users = await Promise.all(
    data.users.map(async ({ passwordSalt, ...u }) => ({
      ...u,
      passwordHash: await hashPassword(LOCAL_PASSWORD, passwordSalt),
    })),
  );
  const insert = async (table: PgTable, rows: object[]) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(table).values(rows.slice(i, i + CHUNK) as never);
    }
  };
  await insert(s.tenants, data.tenants);
  await insert(s.users, users);
  await insert(s.warehouses, data.warehouses);
  await insert(s.products, data.products);
  await insert(s.customers, data.customers);
  await insert(s.stockLevels, data.stockLevels);
  await insert(s.salesOrders, data.salesOrders);
  await insert(s.salesOrderLines, data.salesOrderLines);
  await insert(s.quotes, data.quotes);
  await insert(s.purchaseOrders, data.purchaseOrders);
  await insert(s.purchaseOrderLines, data.purchaseOrderLines);
  await insert(s.dispatches, data.dispatches);
  await insert(s.dispatchEvents, data.dispatchEvents);
  await insert(s.invoices, data.invoices);
  await insert(s.payments, data.payments);
  await insert(s.ledgerEntries, data.ledgerEntries);
  await insert(s.approvalRequests, data.approvalRequests);
  return data;
}
