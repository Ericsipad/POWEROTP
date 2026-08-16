import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import {
  signBotBlockerPolicyRelease,
  type BotBlockerKeyRing,
} from "@powerotp/botblocker-signing";
import type {
  BotBlockerPolicy,
  SignedBotBlockerPolicyRelease,
} from "@powerotp/contracts";

import type {
  BotBlockerPolicyPersistence,
  BotBlockerPolicyScope,
  PolicyReleaseDocument,
} from "./botblocker-policy-persistence.js";
import {
  BotBlockerPolicyPublicationError,
  BotBlockerPolicyService,
} from "./botblocker-policy-service.js";
import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";

const NOW = 1_786_000_000_000;
const SITE_ID = "bbs_0123456789abcdef";
const OTHER_SITE_ID = "bbs_fedcba9876543210";
const KEY_ID = "key_0123456789abcdef";

function keyRing(): BotBlockerKeyRing {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    activeSigningKey: { keyId: KEY_ID, privateKey },
    verificationKeys: { active: { keyId: KEY_ID, publicKey } },
    clockSkewMs: 0,
  };
}

function policy(
  policyVersion = 1,
  overrides: Partial<BotBlockerPolicy> = {},
): BotBlockerPolicy {
  return {
    policyVersion,
    protocolVersion: 1,
    siteId: SITE_ID,
    activatesAt: NOW,
    expiresAt: NOW + 60_000,
    riskWeights: { modelVersion: "test_model", payload: {} },
    challengeMapping: [],
    edgeEndpoints: [],
    sensorVersion: "test_sensor",
    verificationKeys: [{ keyId: KEY_ID }],
    datasetVersions: {},
    revocationFilter: {
      filterVersion: 1,
      checksumSha256: "a".repeat(64),
    },
    ...overrides,
  };
}

function fakePersistence() {
  const site: BotBlockerSiteDocument = {
    _id: SITE_ID,
    customerId: "usr_0123456789abcdef",
    projectId: "prj_0123456789abcdef",
    enabled: true,
    decisionTimeoutMs: 200,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  };
  const releases: PolicyReleaseDocument[] = [];
  const persistence = {
    findSite: async (siteId: string) => siteId === site._id ? site : null,
    insertRelease: async (
      scope: BotBlockerPolicyScope,
      release: SignedBotBlockerPolicyRelease,
      createdAt: Date,
    ) => {
      if (
        site.latestPolicyVersion !== undefined &&
        release.policy.policyVersion <= site.latestPolicyVersion
      ) {
        return "policy_version_regression" as const;
      }
      site.latestPolicyVersion = release.policy.policyVersion;
      const document = toDocument(scope, release, createdAt);
      site.latestPolicyReleaseId = document._id;
      releases.push(document);
      return "inserted" as const;
    },
    findLatestActivatedRelease: async (
      scope: BotBlockerPolicyScope,
      cutoff: Date,
    ) => releases
      .filter((release) =>
        release.customerId === scope.customerId &&
        release.projectId === scope.projectId &&
        release.siteId === scope.siteId &&
        release.activatesAt <= cutoff
      )
      .sort((left, right) => right.policyVersion - left.policyVersion)[0] ?? null,
  } satisfies Pick<
    BotBlockerPolicyPersistence,
    "findSite" | "insertRelease" | "findLatestActivatedRelease"
  >;
  return { site, releases, persistence };
}

function toDocument(
  scope: BotBlockerPolicyScope,
  release: SignedBotBlockerPolicyRelease,
  createdAt = new Date(NOW),
): PolicyReleaseDocument {
  return {
    _id: `bpr_${release.policy.policyVersion}_0123456789abcdef`,
    ...scope,
    policyVersion: release.policy.policyVersion,
    protocolVersion: release.policy.protocolVersion,
    activatesAt: new Date(release.policy.activatesAt),
    expiresAt: new Date(release.policy.expiresAt),
    issuedAt: new Date(release.issuedAt),
    release,
    createdAt,
  };
}

describe("BotBlocker signed policy service", () => {
  it("signs, scopes, verifies, and delivers release metadata", async () => {
    const ring = keyRing();
    const { persistence, releases } = fakePersistence();
    const service = new BotBlockerPolicyService(persistence, ring);

    const published = await service.publish(policy(), NOW);
    assert.equal(published.audience, SITE_ID);
    assert.equal(published.policy.siteId, SITE_ID);
    assert.equal(releases[0]?.customerId, "usr_0123456789abcdef");

    const result = await service.getPolicy(SITE_ID, NOW);
    assert.equal(result.status, "available");
    if (result.status === "available") {
      assert.equal(result.response.release.signature, published.signature);
      assert.equal(result.response.decisionTimeoutMs, 200);
      assert.equal(result.response.release.policy.sensorVersion, "test_sensor");
      assert.match(result.etag, /^"bbp-[A-Za-z0-9_-]+"$/);
    }
  });

  it("rejects equal and older policy versions", async () => {
    const service = new BotBlockerPolicyService(fakePersistence().persistence, keyRing());
    await service.publish(policy(2), NOW);
    for (const version of [2, 1]) {
      await assert.rejects(
        service.publish(policy(version), NOW),
        (error: unknown) =>
          error instanceof BotBlockerPolicyPublicationError &&
          error.code === "policy_version_regression",
      );
    }
  });

  it("does not activate a future release", async () => {
    const service = new BotBlockerPolicyService(fakePersistence().persistence, keyRing());
    await service.publish(
      policy(1, { activatesAt: NOW + 1, expiresAt: NOW + 60_000 }),
      NOW,
    );
    assert.deepEqual(await service.getPolicy(SITE_ID, NOW), { status: "unavailable" });
    assert.equal((await service.getPolicy(SITE_ID, NOW + 1)).status, "available");
  });

  it("serves the current last-known-good release until a newer release activates", async () => {
    const service = new BotBlockerPolicyService(fakePersistence().persistence, keyRing());
    await service.publish(policy(1, { expiresAt: NOW + 60_000 }), NOW);
    await service.publish(
      policy(2, {
        activatesAt: NOW + 1_000,
        expiresAt: NOW + 60_000,
      }),
      NOW,
    );

    const current = await service.getPolicy(SITE_ID, NOW);
    assert.equal(current.status, "available");
    if (current.status === "available") {
      assert.equal(current.response.release.policy.policyVersion, 1);
    }
    const activated = await service.getPolicy(SITE_ID, NOW + 1_000);
    assert.equal(activated.status, "available");
    if (activated.status === "available") {
      assert.equal(activated.response.release.policy.policyVersion, 2);
    }
  });

  it("returns unavailable for expiry and never rolls back to an older release", async () => {
    const serviceState = fakePersistence();
    const service = new BotBlockerPolicyService(serviceState.persistence, keyRing());
    await service.publish(policy(1, { expiresAt: NOW + 60_000 }), NOW);
    await service.publish(policy(2, { expiresAt: NOW + 1_000 }), NOW);

    assert.deepEqual(
      await service.getPolicy(SITE_ID, NOW + 1_000),
      { status: "unavailable" },
    );
  });

  it("rejects tampering, wrong audience, and wrong site binding", async () => {
    const ring = keyRing();
    const state = fakePersistence();
    const service = new BotBlockerPolicyService(state.persistence, ring);
    await service.publish(policy(), NOW);
    const original = state.releases[0]!.release;

    state.releases[0]!.release = {
      ...original,
      policy: { ...original.policy, sensorVersion: "tampered" },
    };
    assert.equal((await service.getPolicy(SITE_ID, NOW)).status, "unavailable");

    state.releases[0]!.release = signBotBlockerPolicyRelease({
      policy: policy(),
      audience: OTHER_SITE_ID,
      nonce: "nonce_wrong_audience_123",
      issuedAt: NOW,
      signingKey: ring.activeSigningKey,
    });
    assert.equal((await service.getPolicy(SITE_ID, NOW)).status, "unavailable");

    state.releases[0]!.release = signBotBlockerPolicyRelease({
      policy: policy(1, { siteId: OTHER_SITE_ID }),
      audience: SITE_ID,
      nonce: "nonce_wrong_site_123456",
      issuedAt: NOW,
      signingKey: ring.activeSigningKey,
    });
    assert.equal((await service.getPolicy(SITE_ID, NOW)).status, "unavailable");

    state.releases[0]!.release = {
      ...original,
      policy: { ...original.policy, protocolVersion: 2 },
    } as unknown as SignedBotBlockerPolicyRelease;
    assert.equal((await service.getPolicy(SITE_ID, NOW)).status, "unavailable");
  });

  it("requires the active verification-key reference before signing", async () => {
    const service = new BotBlockerPolicyService(fakePersistence().persistence, keyRing());
    await assert.rejects(
      service.publish(
        policy(1, {
          verificationKeys: [{ keyId: "key_untrusted_123456" }],
        }),
        NOW,
      ),
      /active BotBlocker verification key/,
    );
  });

  it("returns typed service states for unknown sites and missing keys", async () => {
    const state = fakePersistence();
    const service = new BotBlockerPolicyService(state.persistence, undefined);
    assert.deepEqual(await service.getPolicy(OTHER_SITE_ID, NOW), {
      status: "unknown_site",
    });
    assert.deepEqual(await service.getPolicy(SITE_ID, NOW), {
      status: "unavailable",
    });
  });

  it("does not serve a release while the owning site is disabled", async () => {
    const state = fakePersistence();
    const service = new BotBlockerPolicyService(state.persistence, keyRing());
    await service.publish(policy(), NOW);
    state.site.enabled = false;
    assert.deepEqual(await service.getPolicy(SITE_ID, NOW), {
      status: "unavailable",
    });
  });

  it("changes the ETag when unsigned timeout metadata changes", async () => {
    const state = fakePersistence();
    const service = new BotBlockerPolicyService(state.persistence, keyRing());
    await service.publish(policy(), NOW);
    const first = await service.getPolicy(SITE_ID, NOW);
    state.site.decisionTimeoutMs = 500;
    const second = await service.getPolicy(SITE_ID, NOW);
    assert.equal(first.status, "available");
    assert.equal(second.status, "available");
    if (first.status === "available" && second.status === "available") {
      assert.notEqual(first.etag, second.etag);
    }
  });
});
