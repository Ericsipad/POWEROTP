import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reconcileSmsInteraction,
  reconcileVoiceInteraction,
  SMS_OUTBOUND_RATE_USD,
} from "./provider-reconcile-service.js";

const baseConfig = {
  VOIPMS_SMS_API_USERNAME: "api@example.com",
  VOIPMS_SMS_API_PASSWORD: "test-password",
  TRUNK1_URL: "sip:sanjose2.voip.ms",
  TRUNK1_USER: "334140_power1",
  TRUNK1_PASS: "secret",
};

describe("reconcileVoiceInteraction", () => {
  it("matches the CDR row for the right destination and trunk account, extracting duration/cost", async () => {
    const verification = {
      targetNumber: "+14034701805",
      createdAt: new Date("2026-08-08T18:00:00.000Z"),
      callTrunkId: "trunk-1",
    };

    const outcome = await reconcileVoiceInteraction(
      baseConfig as never,
      verification,
      async () =>
        Response.json({
          status: "success",
          cdr: [
            { destination: "15005550006", account: "334140_power1", date: "2026-08-08 18:00:05", seconds: 12, total: 0.02 },
            { destination: "14034701805", account: "334140_power2", date: "2026-08-08 18:00:03", seconds: 9, total: 0.01 },
            { destination: "14034701805", account: "334140_power1", date: "2026-08-08 18:00:02", seconds: 14, total: 0.025 },
          ],
        }),
    );

    assert.equal(outcome.status, "matched");
    if (outcome.status === "matched") {
      assert.equal(outcome.record.source, "voipms_cdr");
      assert.equal(outcome.record.durationSeconds, 14);
      assert.equal(outcome.record.providerCostUsd, 0.025);
      assert.equal(outcome.record.raw.account, "334140_power1");
    }
  });

  it("reports not_found when no trunk was ever attempted", async () => {
    const outcome = await reconcileVoiceInteraction(
      baseConfig as never,
      { targetNumber: "+14034701805", createdAt: new Date(), callTrunkId: undefined },
      async () => Response.json({ status: "success", cdr: [] }),
    );
    assert.deepEqual(outcome, { status: "not_found" });
  });

  it("reports not_found when nothing in the window matches the destination", async () => {
    const outcome = await reconcileVoiceInteraction(
      baseConfig as never,
      { targetNumber: "+14034701805", createdAt: new Date(), callTrunkId: "trunk-1" },
      async () =>
        Response.json({ status: "success", cdr: [{ destination: "15005550006", account: "334140_power1" }] }),
    );
    assert.deepEqual(outcome, { status: "not_found" });
  });
});

describe("reconcileSmsInteraction", () => {
  it("matches the outbound sms row for the right contact and applies the flat rate", async () => {
    const verification = {
      targetNumber: "+14034701805",
      createdAt: new Date("2026-08-08T18:00:00.000Z"),
      smsDid: "+15559990000",
    };

    const outcome = await reconcileSmsInteraction(
      baseConfig as never,
      verification,
      async () =>
        Response.json({
          status: "success",
          sms: [
            { contact: "14034701805", type: "1", date: "2026-08-08 17:59:00" },
            { contact: "14034701805", type: "0", date: "2026-08-08 18:00:01" },
          ],
        }),
    );

    assert.equal(outcome.status, "matched");
    if (outcome.status === "matched") {
      assert.equal(outcome.record.source, "voipms_sms");
      assert.equal(outcome.record.providerCostUsd, SMS_OUTBOUND_RATE_USD);
      assert.equal(outcome.record.raw.type, "0");
    }
  });

  it("reports not_found without a recorded sending DID", async () => {
    const outcome = await reconcileSmsInteraction(
      baseConfig as never,
      { targetNumber: "+14034701805", createdAt: new Date(), smsDid: undefined },
      async () => Response.json({ status: "success", sms: [] }),
    );
    assert.deepEqual(outcome, { status: "not_found" });
  });
});
