import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostedAuthRealms } from "./hosted-auth-boundaries.js";
import { HostedAuthRequestIdSchema } from "./hosted-auth-identifiers.js";
import {
  HostedAuthBrowserNavigationContextSchema,
  HostedAuthBrowserReturnQuerySchema,
  HostedAuthRouteManifestSchema,
  hostedAuthRouteManifest,
} from "./hosted-auth-route-contracts.js";
import {
  HOSTED_AUTH_ACTIVE_TTL_SECONDS,
  HOSTED_AUTH_API_VERSION,
  HOSTED_AUTH_BROWSER_PROTOCOL_VERSION,
  HOSTED_AUTH_RESULT_TTL_SECONDS,
  HostedAuthActiveTtlSecondsSchema,
  HostedAuthActiveWindowSchema,
  HostedAuthApiVersionSchema,
  HostedAuthBrowserProtocolVersionSchema,
  HostedAuthErrorResponseSchema,
  HostedAuthIdempotencyClaimSchema,
  HostedAuthTerminalResultWindowSchema,
  decideHostedAuthIdempotency,
  isHostedAuthWindowActive,
} from "./hosted-auth-protocol.js";

const canonicalBody = "A".repeat(42) + "E";
const authRequestId = HostedAuthRequestIdSchema.parse(`har_${canonicalBody}`);
const scope = {
  projectId: "project_scope_0001",
  realm: hostedAuthRealms.powerotp_pii,
  flow: "signup",
} as const;
const requestHash = "a".repeat(64);

describe("hosted-auth compatibility versions and stable errors", () => {
  it("accepts only known API and browser protocol versions", () => {
    assert.equal(
      HostedAuthApiVersionSchema.parse(HOSTED_AUTH_API_VERSION),
      "2026-08-21",
    );
    assert.equal(
      HostedAuthBrowserProtocolVersionSchema.parse(
        HOSTED_AUTH_BROWSER_PROTOCOL_VERSION,
      ),
      1,
    );
    assert.equal(HostedAuthApiVersionSchema.safeParse("2027-01-01").success, false);
    assert.equal(HostedAuthBrowserProtocolVersionSchema.safeParse(2).success, false);
  });

  it("strictly validates stable machine-readable errors", () => {
    const error = {
      apiVersion: HOSTED_AUTH_API_VERSION,
      error: {
        code: "rate_limited",
        correlationId: "correlation_000001",
        retryAfterSeconds: 30,
      },
    } as const;
    assert.deepEqual(HostedAuthErrorResponseSchema.parse(error), error);
    assert.equal(
      HostedAuthErrorResponseSchema.safeParse({
        ...error,
        error: { ...error.error, code: "future_error" },
      }).success,
      false,
    );
    assert.equal(
      HostedAuthErrorResponseSchema.safeParse({
        ...error,
        error: { ...error.error, code: "invalid_project" },
      }).success,
      false,
    );
    assert.equal(
      HostedAuthErrorResponseSchema.safeParse({
        ...error,
        internalIdentityId: "must-not-be-exposed",
      }).success,
      false,
    );
  });
});

describe("hosted-auth active and terminal-result TTLs", () => {
  it("accepts active lifetime limits and supplies the canonical default", () => {
    assert.equal(
      HostedAuthActiveTtlSecondsSchema.parse(undefined),
      HOSTED_AUTH_ACTIVE_TTL_SECONDS.default,
    );
    assert.equal(
      HostedAuthActiveTtlSecondsSchema.safeParse(
        HOSTED_AUTH_ACTIVE_TTL_SECONDS.minimum - 1,
      ).success,
      false,
    );
    assert.equal(
      HostedAuthActiveTtlSecondsSchema.safeParse(
        HOSTED_AUTH_ACTIVE_TTL_SECONDS.maximum + 1,
      ).success,
      false,
    );
  });

  it("requires exact active and three-minute result expiries", () => {
    const createdAtMs = 1_700_000_000_000;
    const active = {
      createdAtMs,
      requestExpiresInSeconds: HOSTED_AUTH_ACTIVE_TTL_SECONDS.minimum,
      expiresAtMs:
        createdAtMs + HOSTED_AUTH_ACTIVE_TTL_SECONDS.minimum * 1_000,
    };
    assert.deepEqual(HostedAuthActiveWindowSchema.parse(active), active);
    assert.equal(
      HostedAuthActiveWindowSchema.safeParse({
        ...active,
        expiresAtMs: active.expiresAtMs + 1,
      }).success,
      false,
    );

    const terminal = {
      completedAtMs: createdAtMs,
      resultExpiresAtMs:
        createdAtMs + HOSTED_AUTH_RESULT_TTL_SECONDS * 1_000,
    };
    assert.deepEqual(
      HostedAuthTerminalResultWindowSchema.parse(terminal),
      terminal,
    );
    assert.equal(
      HostedAuthTerminalResultWindowSchema.safeParse({
        ...terminal,
        resultExpiresAtMs: terminal.resultExpiresAtMs - 1,
      }).success,
      false,
    );
  });

  it("treats the exact expiry boundary as unavailable", () => {
    const expiry = 1_000_000;
    assert.equal(isHostedAuthWindowActive(expiry - 1, expiry), true);
    assert.equal(isHostedAuthWindowActive(expiry, expiry), false);
    assert.equal(isHostedAuthWindowActive(expiry + 1, expiry), false);
  });
});

describe("hosted-auth API idempotency", () => {
  const claim = HostedAuthIdempotencyClaimSchema.parse({
    apiVersion: HOSTED_AUTH_API_VERSION,
    key: "idempotency-key-0001",
    operation: "create_auth_request",
    scope,
    requestHash,
  });

  it("distinguishes first use, exact replay, and changed payload", () => {
    assert.deepEqual(decideHostedAuthIdempotency(undefined, claim), {
      outcome: "new",
    });
    assert.deepEqual(decideHostedAuthIdempotency(claim, claim), {
      outcome: "replay",
    });
    assert.deepEqual(
      decideHostedAuthIdempotency(claim, {
        ...claim,
        requestHash: "b".repeat(64) as typeof claim.requestHash,
      }),
      { outcome: "conflict", errorCode: "idempotency_conflict" },
    );
  });

  it("rejects key reuse across project, realm, flow, operation, or version", () => {
    const attempts = [
      { ...claim, scope: { ...scope, projectId: "project_scope_0002" } },
      { ...claim, scope: { ...scope, realm: hostedAuthRealms.didit_pii } },
      { ...claim, scope: { ...scope, flow: "signin" as const } },
      { ...claim, operation: "cancel_auth_request" as const },
    ];
    for (const attempt of attempts) {
      assert.equal(
        decideHostedAuthIdempotency(claim, attempt).outcome,
        "conflict",
      );
    }
    assert.equal(
      HostedAuthIdempotencyClaimSchema.safeParse({
        ...claim,
        apiVersion: "future",
      }).success,
      false,
    );
  });

  it("strictly rejects malformed keys, hashes, and undeclared fields", () => {
    for (const invalid of [
      { ...claim, key: "short" },
      { ...claim, key: "idempotency key with spaces" },
      { ...claim, requestHash: "A".repeat(64) },
      { ...claim, providerPayload: {} },
    ]) {
      assert.equal(HostedAuthIdempotencyClaimSchema.safeParse(invalid).success, false);
    }
  });

  it("requires provider purpose on contact and verification operations", () => {
    assert.equal(
      HostedAuthIdempotencyClaimSchema.safeParse({
        ...claim,
        operation: "send_contact_challenge",
      }).success,
      false,
    );
    assert.equal(
      HostedAuthIdempotencyClaimSchema.safeParse({
        ...claim,
        operation: "send_contact_challenge",
        scope: {
          ...scope,
          providerPurpose: "signup_contact_enrollment",
        },
      }).success,
      true,
    );
    assert.equal(
      HostedAuthIdempotencyClaimSchema.safeParse({
        ...claim,
        operation: "start_provider_verification",
        scope: { ...scope, providerPurpose: "age_assurance" },
      }).success,
      true,
    );
  });
});

describe("PWA-safe hosted-auth routes", () => {
  const context = {
    browserProtocolVersion: HOSTED_AUTH_BROWSER_PROTOCOL_VERSION,
    authRequestId,
    scope,
    requestHandle: "browser_request_handle_000000000001",
    launchSurface: "standalone_pwa",
    navigationAuthority: "server_resolved_request_context",
    completionMechanism: "server_configured_redirect",
  } as const;

  it("supports tab, standalone PWA, and mobile handoff without tab authority", () => {
    for (const launchSurface of [
      "browser_tab",
      "standalone_pwa",
      "mobile_handoff",
    ] as const) {
      assert.equal(
        HostedAuthBrowserNavigationContextSchema.safeParse({
          ...context,
          launchSurface,
        }).success,
        true,
      );
    }
    for (const invalid of [
      { ...context, launchSurface: "window_opener" },
      { ...context, navigationAuthority: "document_referrer" },
      { ...context, pollToken: `prt_${canonicalBody}` },
      { ...context, projectApiKey: "secret" },
    ]) {
      assert.equal(
        HostedAuthBrowserNavigationContextSchema.safeParse(invalid).success,
        false,
      );
    }
  });

  it("keeps browser return hints non-authoritative and minimal", () => {
    assert.equal(
      HostedAuthBrowserReturnQuerySchema.safeParse({
        authRequestId,
        hint: "succeeded",
      }).success,
      true,
    );
    assert.equal(
      HostedAuthBrowserReturnQuerySchema.safeParse({
        authRequestId,
        hint: "succeeded",
        projectUserId: `pusr_${canonicalBody}`,
      }).success,
      false,
    );
  });

  it("requires no-store and audience-specific authority on every route", () => {
    const parsed = HostedAuthRouteManifestSchema.parse(hostedAuthRouteManifest);
    assert.ok(parsed.routes.length > 10);
    assert.equal(
      parsed.routes.every((route) => route.cachePolicy === "no_store"),
      true,
    );
    assert.equal(
      parsed.routes
        .filter((route) => route.audience === "hosted_browser")
        .every(
          (route) =>
            route.method === "GET"
              ? route.authentication === "realm_cookie_and_browser_handle"
              : route.authentication ===
                "realm_cookie_browser_handle_and_csrf",
        ),
      true,
    );
    assert.deepEqual(parsed.forbiddenNavigationAuthorities, [
      "window_opener",
      "browser_history",
      "document_referrer",
    ]);
  });
});
