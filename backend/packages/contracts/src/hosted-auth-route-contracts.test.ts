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
import { HOSTED_AUTH_BROWSER_PROTOCOL_VERSION } from "./hosted-auth-protocol.js";

const canonicalBody = "A".repeat(42) + "E";
const authRequestId = HostedAuthRequestIdSchema.parse(`har_${canonicalBody}`);
const scope = {
  projectId: "project_scope_0001",
  realm: hostedAuthRealms.powerotp_pii,
  flow: "signup",
} as const;
const context = {
  browserProtocolVersion: HOSTED_AUTH_BROWSER_PROTOCOL_VERSION,
  authRequestId,
  scope,
  requestHandle: "browser_request_handle_000000000001",
  launchSurface: "standalone_pwa",
  navigationAuthority: "server_resolved_request_context",
  completionMechanism: "server_configured_redirect",
} as const;

describe("PWA-safe hosted-auth routes", () => {
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
        .every((route) =>
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
