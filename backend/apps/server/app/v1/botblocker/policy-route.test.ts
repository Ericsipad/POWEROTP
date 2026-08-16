import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BotBlockerPolicyFetchResult } from "@powerotp/api/botblocker-policy-service.js";

import { botBlockerPolicyHttpResponse } from "@/lib/botblocker-policy-http";
import { ifNoneMatchMatches } from "@/lib/http-etag";

describe("BotBlocker policy conditional responses", () => {
  const etag = "\"bbp-current\"";

  it("matches exact, weak, list, and wildcard validators", () => {
    assert.equal(ifNoneMatchMatches(etag, etag), true);
    assert.equal(ifNoneMatchMatches(`W/${etag}`, etag), true);
    assert.equal(
      ifNoneMatchMatches(`"bbp-old", W/${etag}, "bbp-other"`, etag),
      true,
    );
    assert.equal(ifNoneMatchMatches("*", etag), true);
  });

  it("does not match absent or stale validators", () => {
    assert.equal(ifNoneMatchMatches(null, etag), false);
    assert.equal(ifNoneMatchMatches("\"bbp-old\"", etag), false);
  });

  it("returns a body on 200 and no body on a matching 304", async () => {
    const available: BotBlockerPolicyFetchResult = {
      status: "available",
      etag,
      response: {
        decisionTimeoutMs: 200,
        release: {
          signatureStatus: "signed",
          keyId: "key_0123456789abcdef",
          signature: "a".repeat(86),
          audience: "bbs_0123456789abcdef",
          nonce: "nonce_0123456789abcdef",
          issuedAt: 1,
          policy: {
            policyVersion: 1,
            protocolVersion: 1,
            siteId: "bbs_0123456789abcdef",
            activatesAt: 1,
            expiresAt: 2,
            riskWeights: { modelVersion: "test", payload: {} },
            challengeMapping: [],
            edgeEndpoints: [],
            sensorVersion: "test",
            verificationKeys: [{ keyId: "key_0123456789abcdef" }],
            datasetVersions: {},
            revocationFilter: {
              filterVersion: 1,
              checksumSha256: "a".repeat(64),
            },
          },
        },
      },
    };
    const fresh = botBlockerPolicyHttpResponse(null, available);
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.get("etag"), etag);
    assert.equal(
      fresh.headers.get("cache-control"),
      "public, max-age=0, must-revalidate",
    );
    assert.equal((await fresh.json()).decisionTimeoutMs, 200);

    const unchanged = botBlockerPolicyHttpResponse(etag, available);
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.headers.get("etag"), etag);
    assert.equal(await unchanged.text(), "");
  });

  it("maps unknown and unavailable policy states to strict typed responses", async () => {
    const unknown = botBlockerPolicyHttpResponse(null, { status: "unknown_site" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get("cache-control"), "no-store");
    assert.deepEqual(await unknown.json(), {
      status: "error",
      code: "unknown_site",
      message: "The BotBlocker site does not exist",
    });

    const unavailable = botBlockerPolicyHttpResponse(null, {
      status: "unavailable",
    });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("cache-control"), "no-store");
    assert.deepEqual(await unavailable.json(), {
      status: "unavailable",
      reason: "policy_unavailable",
      message: "No valid active policy release is available",
      retryable: true,
    });
  });
});
