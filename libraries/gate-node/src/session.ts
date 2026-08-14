import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { appendPrivateCookie, readCookie } from "./cookies.js";
import type { GateSession, GateSessionStore } from "./types.js";

export function createMemoryGateSessionStore(maxEntries = 10_000): GateSessionStore {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError("Session-store capacity must be a positive integer");
  }
  const sessions = new Map<string, GateSession>();
  return {
    get(id) {
      const session = sessions.get(id);
      if (session) {
        sessions.delete(id);
        sessions.set(id, session);
      }
      return session;
    },
    set(session) {
      if (!sessions.has(session.id) && sessions.size >= maxEntries) {
        const evictable = Array.from(sessions.entries()).find(
          ([, candidate]) => candidate.activeChallenge === undefined,
        )?.[0];
        if (evictable === undefined) throw new GateSessionCapacityError();
        sessions.delete(evictable);
      }
      sessions.delete(session.id);
      sessions.set(session.id, session);
    },
  };
}

export class GateSessionCapacityError extends Error {
  constructor() {
    super("Gate session capacity is exhausted");
  }
}

export async function resolveGateSession(options: {
  request: IncomingMessage;
  response: ServerResponse;
  store: GateSessionStore;
  cookieName: string;
  secure: boolean;
}): Promise<GateSession | undefined> {
  const currentId = readCookie(options.request, options.cookieName);
  const current = currentId ? await options.store.get(currentId) : undefined;
  if (current) return current;

  const session: GateSession = {
    id: randomBytes(24).toString("base64url"),
    nextSequence: 0,
    acceptedNonces: [],
  };
  try {
    await options.store.set(session);
  } catch (error) {
    if (error instanceof GateSessionCapacityError) return undefined;
    throw error;
  }
  appendPrivateCookie(options.response, options.cookieName, session.id, {
    secure: options.secure,
  });
  return session;
}
