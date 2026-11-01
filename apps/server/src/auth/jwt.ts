import { createHmac, timingSafeEqual } from "node:crypto";
import { ROLES, type Role, type Scope, type TenantId, type UserId } from "@genui-erp/db";

export type Claims = { sub: UserId; tid: TenantId; role: Role; name: string; iat: number; exp: number };

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");
const HEADER = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));

export function signToken(
  claims: Omit<Claims, "iat" | "exp">,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const body = b64(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds }));
  const sig = createHmac("sha256", secret).update(`${HEADER}.${body}`).digest("base64url");
  return `${HEADER}.${body}.${sig}`;
}

/** Returns the claims of a valid, unexpired token, or null. */
export function verifyToken(token: string, secret: string, now = Date.now()): Claims | null {
  const [header, body, sig] = token.split(".");
  if (header !== HEADER || !body || !sig) return null;
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (!ROLES.includes(claims.role) || typeof claims.sub !== "string" || typeof claims.tid !== "string") return null;
  return claims;
}

export const scopeOf = (c: Claims): Scope => ({ tenantId: c.tid, userId: c.sub, role: c.role });
