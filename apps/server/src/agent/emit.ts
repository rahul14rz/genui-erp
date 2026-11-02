import type { FastifyBaseLogger } from "fastify";
import { CATALOG_ID, type RoleCatalog } from "./catalog.ts";
import { guardMessage, type A2uiMessage } from "./guard.ts";

/** One A2A message part, as written into a status-update event. */
export type Part =
  | { kind: "text"; text: string }
  | { kind: "data"; data: Record<string, unknown> };

export type Emitter = {
  status(text: string): void;
  pending(surfaceId: string, components: string[]): void;
  /** Sends one A2UI message, unless the guard rejects it. */
  a2ui(msg: A2uiMessage): void;
  text(text: string): void;
};

/**
 * The only path from the agent to the wire. Every A2UI message is checked
 * against the role's catalog here. A rejected message is logged and replaced
 * with an error notice built by the server, which is checked the same way.
 */
export function createEmitter(write: (parts: Part[]) => void, catalog: RoleCatalog, log: FastifyBaseLogger): Emitter {
  const send = (msg: A2uiMessage) => write([{ kind: "data", data: msg as unknown as Record<string, unknown> }]);
  return {
    status: (text) => write([{ kind: "data", data: { erpStatus: text } }]),
    pending: (surfaceId, components) => write([{ kind: "data", data: { erpPending: { surfaceId, components } } }]),
    text: (text) => write([{ kind: "text", text }]),
    a2ui(msg) {
      const errors = guardMessage(msg, catalog);
      if (errors.length === 0) return send(msg);
      // Reasons only: the message itself carries tenant data.
      log.warn({ role: catalog.role, errors }, "guard_rejected");
      const surfaceId = "updateComponents" in msg ? msg.updateComponents.surfaceId : "guard-error";
      const replacement = errorSurface(surfaceId, "This answer was blocked", "Part of the answer referenced something your role cannot see, so it was not shown.", "Try asking the question in a narrower way.");
      for (const m of replacement) if (guardMessage(m, catalog).length === 0) send(m);
    },
  };
}

export function errorSurface(surfaceId: string, title: string, body: string, nextStep: string): A2uiMessage[] {
  return [
    { version: "v0.9", createSurface: { surfaceId, catalogId: CATALOG_ID } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [
          { id: "root", component: "Panel", title, children: ["n"] },
          { id: "n", component: "Notice", tone: "danger", title, body, nextStep },
        ],
      },
    },
  ];
}
