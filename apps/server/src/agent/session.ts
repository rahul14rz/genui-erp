import type { Scope } from "@genui-erp/db";
import type { ChatMessage } from "../model/types.ts";
import type { ComponentSpec, StoredResult } from "./surface.ts";

export type SurfaceState = {
  /** The model's components, still holding bindings, so paging can re-resolve them. */
  spec: ComponentSpec[];
  bindings: Map<string, string[]>;
};

export type PendingAction = { action: string; input: Record<string, unknown>; surfaceId: string };

export type Session = {
  contextId: string;
  scope: Scope;
  userName: string;
  tenant: { name: string; currency: string };
  history: ChatMessage[];
  results: Map<string, StoredResult>;
  surfaces: Map<string, SurfaceState>;
  pending: Map<string, PendingAction>;
  seq: { result: number; surface: number };
  touched: number;
};

const TTL_MS = 2 * 3600_000;
const MAX_SESSIONS = 500;

/** In-memory conversation state. A context id only ever belongs to the user who opened it. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  get(
    contextId: string | undefined,
    scope: Scope,
    init: { userName: string; tenant: { name: string; currency: string } },
    newId: () => string,
  ): Session {
    this.sweep();
    const existing = contextId ? this.sessions.get(contextId) : undefined;
    if (
      existing &&
      existing.scope.userId === scope.userId &&
      existing.scope.tenantId === scope.tenantId &&
      existing.scope.role === scope.role
    ) {
      existing.touched = Date.now();
      return existing;
    }
    // An unknown context, or one that belongs to someone else, starts fresh
    // rather than exposing another user's results.
    const session: Session = {
      contextId: newId(),
      scope,
      ...init,
      history: [],
      results: new Map(),
      surfaces: new Map(),
      pending: new Map(),
      seq: { result: 0, surface: 0 },
      touched: Date.now(),
    };
    this.sessions.set(session.contextId, session);
    return session;
  }

  private sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (now - s.touched > TTL_MS) this.sessions.delete(id);
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
  }
}
