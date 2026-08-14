import { createHash } from "node:crypto";

import {
  signBotBlockerPolicyRelease,
  verifyBotBlockerPolicyRelease,
  type BotBlockerKeyRing,
} from "@powerotp/botblocker-signing";
import {
  BotBlockerPolicyResponseSchema,
  BotBlockerPolicySchema,
  type BotBlockerPolicy,
  type BotBlockerPolicyResponse,
} from "@powerotp/contracts";
import { ZodError } from "zod";

import {
  BotBlockerPolicyPersistence,
  type PolicyReleaseDocument,
} from "./botblocker-policy-persistence.js";
import { createSecret } from "./security.js";

export type BotBlockerPolicyFetchResult =
  | { status: "available"; response: BotBlockerPolicyResponse; etag: string }
  | { status: "unavailable" }
  | { status: "unknown_site" };

export class BotBlockerPolicyService {
  readonly #persistence: Pick<
    BotBlockerPolicyPersistence,
    "findSite" | "findLatestActivatedRelease" | "insertRelease"
  >;
  readonly #keyRing: BotBlockerKeyRing | undefined;

  constructor(
    persistence: Pick<
      BotBlockerPolicyPersistence,
      "findSite" | "findLatestActivatedRelease" | "insertRelease"
    >,
    keyRing: BotBlockerKeyRing | undefined,
  ) {
    this.#persistence = persistence;
    this.#keyRing = keyRing;
  }

  /**
   * Internal publication primitive for the Phase 8 administrative surface.
   * It never accepts a signature: the server validates, signs, self-verifies,
   * and then asks MongoDB to advance the version atomically.
   */
  async publish(
    input: BotBlockerPolicy,
    now = Date.now(),
  ): Promise<PolicyReleaseDocument["release"]> {
    if (!this.#keyRing) throw new Error("BotBlocker signing is not configured");
    const policy = BotBlockerPolicySchema.parse(input);
    const site = await this.#persistence.findSite(policy.siteId);
    if (!site) throw new BotBlockerPolicyPublicationError("unknown_site");
    if (
      !policy.verificationKeys.some(
        ({ keyId }) => keyId === this.#keyRing?.activeSigningKey.keyId,
      )
    ) {
      throw new Error("Policy must reference the active BotBlocker verification key");
    }

    const release = signBotBlockerPolicyRelease({
      policy,
      audience: site._id,
      nonce: createSecret(24),
      issuedAt: now,
      signingKey: this.#keyRing.activeSigningKey,
    });
    const verified = verifyBotBlockerPolicyRelease({
      release,
      verificationKeys: this.#keyRing.verificationKeys,
      expectedAudience: site._id,
      expectedSiteId: site._id,
      now,
      clockSkewMs: this.#keyRing.clockSkewMs,
    });
    if (!verified.ok) throw new Error("Server-created policy failed self-verification");

    const result = await this.#persistence.insertRelease(
      {
        customerId: site.customerId,
        projectId: site.projectId,
        siteId: site._id,
      },
      release,
      new Date(now),
    );
    if (result === "policy_version_regression") {
      throw new BotBlockerPolicyPublicationError("policy_version_regression");
    }
    return release;
  }

  async getPolicy(siteId: string, now = Date.now()): Promise<BotBlockerPolicyFetchResult> {
    const site = await this.#persistence.findSite(siteId);
    if (!site) return { status: "unknown_site" };
    if (!site.enabled) return { status: "unavailable" };
    if (!this.#keyRing) return { status: "unavailable" };

    let candidate: PolicyReleaseDocument | null;
    try {
      candidate = await this.#persistence.findLatestActivatedRelease(
        {
          customerId: site.customerId,
          projectId: site.projectId,
          siteId: site._id,
        },
        new Date(now),
      );
    } catch (error) {
      if (error instanceof ZodError) return { status: "unavailable" };
      throw error;
    }
    if (!candidate) return { status: "unavailable" };

    const verified = verifyBotBlockerPolicyRelease({
      release: candidate.release,
      verificationKeys: this.#keyRing.verificationKeys,
      expectedAudience: site._id,
      expectedSiteId: site._id,
      now,
      clockSkewMs: this.#keyRing.clockSkewMs,
    });
    if (!verified.ok || candidate.activatesAt.getTime() > now) {
      return { status: "unavailable" };
    }

    const response = BotBlockerPolicyResponseSchema.parse({
      release: verified.value,
      decisionTimeoutMs: site.decisionTimeoutMs,
    });
    return {
      status: "available",
      response,
      etag: policyEtag(response),
    };
  }
}

export class BotBlockerPolicyPublicationError extends Error {
  constructor(
    readonly code: "unknown_site" | "policy_version_regression",
  ) {
    super(code);
    this.name = "BotBlockerPolicyPublicationError";
  }
}

export function policyEtag(response: BotBlockerPolicyResponse): string {
  const digest = createHash("sha256")
    .update(response.release.keyId)
    .update("\0")
    .update(response.release.signature)
    .update("\0")
    .update(String(response.decisionTimeoutMs))
    .digest("base64url");
  return `"bbp-${digest}"`;
}
