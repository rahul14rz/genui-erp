import type { Role } from "@genui-erp/db";
import { ROLE_PERMISSIONS, type Permission } from "./generated/permissions.ts";

export type { Permission };

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ROLE_PERMISSIONS.owner),
  sales_rep: new Set(ROLE_PERMISSIONS.sales_rep),
  warehouse: new Set(ROLE_PERMISSIONS.warehouse),
  accounts: new Set(ROLE_PERMISSIONS.accounts),
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].has(permission);
}
