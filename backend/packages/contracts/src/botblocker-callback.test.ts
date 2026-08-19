import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BotBlockerDataReadyCallbackEnvelopeSchema,
  BotBlockerSessionDataResponseSchema,
} from "./botblocker-callback.js";

const event = {
  eventId: "bbd_1234567890123456",
  type: "botblocker.session_data_ready",
  projectId: "prj_1234567890123456",
  siteId: "bbs_1234567890123456",
  gateSessionId: "bgs_1234567890123456",
  occurredAt: "2026-08-18T12:00:00.000Z",
  nonce: "nonce_1234567890123456",
} as const;

describe("BotBlocker project callback contracts", () => {
  it("accepts only bounded notification binding", () => {
    const parsed = BotBlockerDataReadyCallbackEnvelopeSchema.parse({
      apiVersion: "2026-08-04",
      event,
    });
    assert.deepEqual(Object.keys(parsed.event).sort(), [
      "eventId",
      "gateSessionId",
      "nonce",
      "occurredAt",
      "projectId",
      "siteId",
      "type",
    ]);
  });

  it("rejects scores, raw evidence, credentials, and tokens in callbacks", () => {
    for (const prohibited of [
      "currentScore",
      "fingerprint",
      "ipHistory",
      "siteCredential",
      "visitorToken",
    ]) {
      assert.equal(
        BotBlockerDataReadyCallbackEnvelopeSchema.safeParse({
          apiVersion: "2026-08-04",
          event: { ...event, [prohibited]: "secret" },
        }).success,
        false,
      );
    }
  });

  it("allows the authenticated pull response to return current score", () => {
    assert.equal(
      BotBlockerSessionDataResponseSchema.safeParse({
        apiVersion: "2026-08-04",
        eventId: event.eventId,
        projectId: event.projectId,
        siteId: event.siteId,
        gateSessionId: event.gateSessionId,
        currentScore: { status: "available", score: 42 },
        decision: "otp",
        updatedAt: event.occurredAt,
      }).success,
      true,
    );
  });
});
