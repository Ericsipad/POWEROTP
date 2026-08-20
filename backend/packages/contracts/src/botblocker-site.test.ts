import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  BOTBLOCKER_TIMEOUT_MAX_MS,
  BOTBLOCKER_TIMEOUT_MIN_MS,
} from "./botblocker.js";
import {
  BotBlockerSiteConfigurationSchema,
  DEFAULT_BOTBLOCKER_SITE_CONFIGURATION,
  DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS,
  resolveBotBlockerOtpPolicy,
  type BotBlockerSiteConfiguration,
  UpdateBotBlockerSiteConfigurationSchema,
} from "./botblocker-site.js";

const validConfiguration: BotBlockerSiteConfiguration = {
  siteId: "bbs_1234567890123456",
  projectId: "prj_1234567890123456",
  webhookId: `bwh_${"A".repeat(120)}.${"B".repeat(43)}`,
  enabled: false,
  decisionTimeoutMs: BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  otpMethodMarkers: [...DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS],
  otpPolicyVersion: 0,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("BotBlocker site configuration contracts", () => {
  it("defaults to disabled with the recommended timeout", () => {
    assert.deepEqual(DEFAULT_BOTBLOCKER_SITE_CONFIGURATION, {
      enabled: false,
      decisionTimeoutMs: 200,
      otpMethodMarkers: DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS,
      otpPolicyVersion: 0,
    });
  });

  it("accepts inclusive timeout boundaries", () => {
    for (const decisionTimeoutMs of [
      BOTBLOCKER_TIMEOUT_MIN_MS,
      BOTBLOCKER_TIMEOUT_MAX_MS,
    ]) {
      assert.equal(
        UpdateBotBlockerSiteConfigurationSchema.safeParse({
          decisionTimeoutMs,
        }).success,
        true,
      );
    }
  });

  it("rejects out-of-range and non-integer timeouts", () => {
    for (const decisionTimeoutMs of [
      BOTBLOCKER_TIMEOUT_MIN_MS - 1,
      BOTBLOCKER_TIMEOUT_MAX_MS + 1,
      200.5,
    ]) {
      assert.equal(
        UpdateBotBlockerSiteConfigurationSchema.safeParse({
          decisionTimeoutMs,
        }).success,
        false,
      );
    }
  });

  it("requires at least one recognized update field", () => {
    assert.equal(UpdateBotBlockerSiteConfigurationSchema.safeParse({}).success, false);
    assert.equal(
      UpdateBotBlockerSiteConfigurationSchema.safeParse({ active: true }).success,
      false,
    );
    assert.equal(
      UpdateBotBlockerSiteConfigurationSchema.safeParse({
        webhookId: validConfiguration.webhookId,
      }).success,
      false,
    );
  });

  it("requires a distinct webhookId separate from siteId", () => {
    assert.equal(
      BotBlockerSiteConfigurationSchema.safeParse(validConfiguration).success,
      true,
    );
    const { webhookId: _omitted, ...withoutWebhookId } = validConfiguration;
    assert.equal(
      BotBlockerSiteConfigurationSchema.safeParse(withoutWebhookId).success,
      false,
    );
  });

  it("cannot expose credentials or signing configuration", () => {
    const withCredential: BotBlockerSiteConfiguration = {
      ...validConfiguration,
      // @ts-expect-error -- credentials are server-only and never part of this response.
      siteCredential: "secret",
    };
    assert.equal(
      BotBlockerSiteConfigurationSchema.safeParse(withCredential).success,
      false,
    );

    assert.equal(
      BotBlockerSiteConfigurationSchema.safeParse({
        ...validConfiguration,
        privateSigningKey: "secret",
      }).success,
      false,
    );
  });

  it("requires one bounded marker for every OTP method", () => {
    assert.equal(
      UpdateBotBlockerSiteConfigurationSchema.safeParse({
        otpMethodMarkers: DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS,
      }).success,
      true,
    );
    assert.equal(
      UpdateBotBlockerSiteConfigurationSchema.safeParse({
        otpMethodMarkers: DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS.slice(1),
      }).success,
      false,
    );
    assert.equal(
      UpdateBotBlockerSiteConfigurationSchema.safeParse({
        otpMethodMarkers: DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS.map((marker) =>
          marker.method === "voice_code"
            ? { ...marker, triggerScore: 101 }
            : marker,
        ),
      }).success,
      false,
    );
  });

  it("rejects ambiguous enabled markers at the same score", () => {
    const otpMethodMarkers = DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS.map(
      (marker, index) => ({
        ...marker,
        enabled: index < 2,
        triggerScore: index < 2 ? 50 : marker.triggerScore,
      }),
    );
    assert.equal(
      UpdateBotBlockerSiteConfigurationSchema.safeParse({
        otpMethodMarkers,
      }).success,
      false,
    );
  });

  it("selects the highest enabled marker at or below the score", () => {
    assert.deepEqual(
      resolveBotBlockerOtpPolicy(100, DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS),
      { outcome: "allow" },
    );
    const otpMethodMarkers = DEFAULT_BOTBLOCKER_OTP_METHOD_MARKERS.map(
      (marker) => ({
        ...marker,
        enabled:
          marker.method === "call_reachability" ||
          marker.method === "voice_code",
      }),
    );
    assert.deepEqual(resolveBotBlockerOtpPolicy(19, otpMethodMarkers), {
      outcome: "allow",
    });
    assert.deepEqual(resolveBotBlockerOtpPolicy(20, otpMethodMarkers), {
      outcome: "otp",
      method: "call_reachability",
    });
    assert.deepEqual(resolveBotBlockerOtpPolicy(75, otpMethodMarkers), {
      outcome: "otp",
      method: "voice_code",
    });
  });
});
