import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import type {
  BotBlockerDataReadyCallbackEnvelope,
  BotBlockerSessionDataResponse,
} from "@powerotp/contracts";

import {
  handleProjectCallback,
  PROJECT_CALLBACK_PATH,
} from "./callbacks.js";
import { DEFAULT_LIMITS } from "./http.js";
import { createServices } from "./runtime.js";
import { createMemoryGateSessionStore } from "./session.js";

const now = Date.parse("2026-08-18T12:00:00.000Z");
const secret = "project-callback-secret-with-32-characters";
const event = {
  eventId: "bbd_1234567890123456",
  type: "botblocker.session_data_ready",
  projectId: "prj_1234567890123456",
  siteId: "bbs_1234567890123456",
  gateSessionId: "bgs_1234567890123456",
  occurredAt: new Date(now).toISOString(),
  nonce: "nonce_1234567890123456",
} as const;

describe("project callback middleware", () => {
  it("verifies binding and pulls authoritative data with only the server-held token", async () => {
    const state = await fixture();
    const result = await deliver(state, envelope());

    assert.equal(result.statusCode, 202);
    assert.deepEqual(state.authorizations, [{ visitorToken: "visitor-token-server-only-value" }]);
    assert.equal(
      (await state.store.get(event.gateSessionId))?.authoritativeSessionData
        ?.currentScore.status,
      "available",
    );
  });

  it("rejects wrong binding, stale or bad signatures, duplicate events, and replayed nonces", async () => {
    const wrongProject = await fixture();
    assert.equal(
      (await deliver(wrongProject, envelope({
        projectId: "prj_wrong_1234567890",
      }))).statusCode,
      403,
    );
    const wrongSite = await fixture();
    assert.equal(
      (await deliver(wrongSite, envelope({
        siteId: "bbs_wrong_1234567890",
      }))).statusCode,
      403,
    );
    const wrongSession = await fixture();
    assert.equal(
      (await deliver(wrongSession, envelope({
        gateSessionId: "bgs_wrong_1234567890",
      }))).statusCode,
      503,
    );
    const stale = await fixture();
    assert.equal(
      (await deliver(stale, envelope(), now - 10 * 60 * 1_000)).statusCode,
      401,
    );
    const badSignature = await fixture();
    assert.equal(
      (await deliver(badSignature, envelope(), now, "bad-signature")).statusCode,
      401,
    );

    const replay = await fixture();
    assert.equal((await deliver(replay, envelope())).statusCode, 202);
    assert.equal((await deliver(replay, envelope())).statusCode, 409);
    assert.equal(
      (await deliver(replay, envelope({
        eventId: "bbd_abcdefghijklmnop",
      }))).statusCode,
      409,
    );
    assert.equal(replay.authorizations.length, 1);
  });

  it("does not pull until the scoped visitor token exists", async () => {
    const state = await fixture(false);
    const result = await deliver(state, envelope());
    assert.equal(result.statusCode, 503);
    assert.deepEqual(state.authorizations, []);
  });
});

async function fixture(withVisitorToken = true) {
  const store = createMemoryGateSessionStore();
  await store.set({
    id: event.gateSessionId,
    nextSequence: 0,
    acceptedNonces: [],
    ...(withVisitorToken
      ? { visitorToken: "visitor-token-server-only-value" }
      : {}),
  });
  const authorizations: Array<{ visitorToken: string }> = [];
  const services = createServices({
    async pullSessionData(
      callbackEvent,
      authorization,
    ): Promise<BotBlockerSessionDataResponse> {
      authorizations.push(authorization);
      return {
        apiVersion: "2026-08-04",
        eventId: callbackEvent.eventId,
        projectId: callbackEvent.projectId,
        siteId: callbackEvent.siteId,
        gateSessionId: callbackEvent.gateSessionId,
        currentScore: { status: "available", score: 42 },
        updatedAt: new Date(now).toISOString(),
      };
    },
  });
  return { store, services, authorizations };
}

function envelope(
  changes: Partial<BotBlockerDataReadyCallbackEnvelope["event"]> = {},
): BotBlockerDataReadyCallbackEnvelope {
  return {
    apiVersion: "2026-08-04",
    event: { ...event, ...changes },
  };
}

async function deliver(
  state: Awaited<ReturnType<typeof fixture>>,
  body: BotBlockerDataReadyCallbackEnvelope,
  timestamp = now,
  signatureOverride?: string,
) {
  const raw = JSON.stringify(body);
  const signature = signatureOverride ?? sign(raw, timestamp);
  const request = Object.assign(Readable.from([raw]), {
    method: "POST",
    url: PROJECT_CALLBACK_PATH,
    headers: {
      "content-type": "application/json",
      "powerotp-signature": signature,
    },
    rawHeaders: [
      "content-type",
      "application/json",
      "powerotp-signature",
      signature,
    ],
  }) as unknown as IncomingMessage;
  const response = new ResponseCapture();
  await handleProjectCallback(
    request,
    response as unknown as ServerResponse,
    PROJECT_CALLBACK_PATH,
    {
      projectId: event.projectId,
      siteId: event.siteId,
      callbackSigningSecret: secret,
      limits: DEFAULT_LIMITS,
      services: state.services,
      store: state.store,
      now: () => now,
    },
  );
  return response;
}

function sign(body: string, timestamp: number) {
  const value = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("base64url");
  return `t=${timestamp},v1=${value}`;
}

class ResponseCapture {
  headersSent = false;
  statusCode = 200;
  body = "";

  writeHead(statusCode: number) {
    this.statusCode = statusCode;
    this.headersSent = true;
    return this;
  }

  end(value?: string) {
    this.body = value ?? "";
    this.headersSent = true;
    return this;
  }
}
