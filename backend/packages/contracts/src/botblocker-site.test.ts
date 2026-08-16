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
  type BotBlockerSiteConfiguration,
  UpdateBotBlockerSiteConfigurationSchema,
} from "./botblocker-site.js";

const validConfiguration: BotBlockerSiteConfiguration = {
  siteId: "bbs_1234567890123456",
  projectId: "prj_1234567890123456",
  webhookId: "bwh_1234567890123456",
  enabled: false,
  decisionTimeoutMs: BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("BotBlocker site configuration contracts", () => {
  it("defaults to disabled with the recommended timeout", () => {
    assert.deepEqual(DEFAULT_BOTBLOCKER_SITE_CONFIGURATION, {
      enabled: false,
      decisionTimeoutMs: 200,
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
});
