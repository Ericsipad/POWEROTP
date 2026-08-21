import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hostedAuthProductBoundary,
  hostedAuthRealms,
  HostedAuthPersonProfileModelSchema,
  HostedAuthProductBoundarySchema,
  HostedAuthRealmSchema,
} from "./hosted-auth-boundaries.js";

const profileIsolation = {
  passkeys: "realm_profile",
  userHandles: "realm_profile",
  cookies: "realm_profile",
} as const;

describe("HostedAuthRealmSchema", () => {
  it("locks each custody mode to its own origin and RP ID", () => {
    assert.equal(
      HostedAuthRealmSchema.safeParse(hostedAuthRealms.powerotp_pii).success,
      true,
    );
    assert.equal(
      HostedAuthRealmSchema.safeParse(hostedAuthRealms.didit_pii).success,
      true,
    );
  });

  it("rejects cross-realm RP and origin combinations", () => {
    assert.equal(
      HostedAuthRealmSchema.safeParse({
        identityDataMode: "powerotp_pii",
        origin: "https://authz.powerotp.com",
        rpId: "authz.powerotp.com",
      }).success,
      false,
    );
    assert.equal(
      HostedAuthRealmSchema.safeParse({
        identityDataMode: "didit_pii",
        origin: "https://authx.powerotp.com",
        rpId: "authx.powerotp.com",
      }).success,
      false,
    );
  });
});

describe("HostedAuthPersonProfileModelSchema", () => {
  it("allows both isolated realm profiles under one private person root", () => {
    assert.equal(
      HostedAuthPersonProfileModelSchema.safeParse({
        personRoot: "private_hosted_person",
        profiles: [
          hostedAuthRealms.powerotp_pii,
          hostedAuthRealms.didit_pii,
        ],
        profileIsolation,
      }).success,
      true,
    );
  });

  it("rejects duplicate profiles for one custody mode", () => {
    assert.equal(
      HostedAuthPersonProfileModelSchema.safeParse({
        personRoot: "private_hosted_person",
        profiles: [
          hostedAuthRealms.powerotp_pii,
          hostedAuthRealms.powerotp_pii,
        ],
        profileIsolation,
      }).success,
      false,
    );
  });

  it("rejects shared passkeys, handles, or cookies", () => {
    assert.equal(
      HostedAuthPersonProfileModelSchema.safeParse({
        personRoot: "private_hosted_person",
        profiles: [hostedAuthRealms.powerotp_pii],
        profileIsolation: {
          ...profileIsolation,
          passkeys: "person_root",
        },
      }).success,
      false,
    );
  });
});

describe("HostedAuthProductBoundarySchema", () => {
  it("accepts the canonical hosted-auth product boundary", () => {
    assert.equal(
      HostedAuthProductBoundarySchema.safeParse(hostedAuthProductBoundary)
        .success,
      true,
    );
  });

  it("rejects Passport, BotBlocker, SSO, and global-ID conflation", () => {
    for (const invalidBoundary of [
      { ...hostedAuthProductBoundary, passportRelationship: "same_identity" },
      { ...hostedAuthProductBoundary, botBlockerRelationship: "same_service" },
      { ...hostedAuthProductBoundary, crossClientSso: true },
      { ...hostedAuthProductBoundary, clientIdentityScope: "global" },
    ]) {
      assert.equal(
        HostedAuthProductBoundarySchema.safeParse(invalidBoundary).success,
        false,
      );
    }
  });

  it("rejects undeclared fields, including sensitive client exposure", () => {
    assert.equal(
      HostedAuthProductBoundarySchema.safeParse({
        ...hostedAuthProductBoundary,
        clientReceivesPii: true,
      }).success,
      false,
    );
  });
});
