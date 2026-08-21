import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hostedAuthDataClasses,
  HostedAuthDataClassificationSchema,
} from "./hosted-auth-data-classes.js";
import {
  hostedAuthAbuseCases,
  hostedAuthContactCustody,
  hostedAuthTrustBoundary,
  HostedAuthAbuseCaseSetSchema,
  HostedAuthContactCustodySchema,
  HostedAuthTrustBoundarySchema,
} from "./hosted-auth-data-governance.js";

describe("HostedAuthDataClassificationSchema", () => {
  it("assigns every canonical data class an owner, store, exposure, retention, and deletion rule", () => {
    assert.equal(
      HostedAuthDataClassificationSchema.safeParse(hostedAuthDataClasses)
        .success,
      true,
    );
  });

  it("rejects missing, duplicate, or directionally changed data classes", () => {
    const changedExposure = hostedAuthDataClasses.map((entry) =>
      entry.dataClass === "person_profile_metadata"
        ? { ...entry, clientExposure: "project_user_id_only" as const }
        : entry,
    );

    for (const invalid of [
      hostedAuthDataClasses.slice(1),
      [...hostedAuthDataClasses.slice(0, -1), hostedAuthDataClasses[0]],
      changedExposure,
    ]) {
      assert.equal(
        HostedAuthDataClassificationSchema.safeParse(invalid).success,
        false,
      );
    }
  });

  it("keeps recoverable contact mode-specific and out of client systems", () => {
    const powerOtpContact = hostedAuthDataClasses.find(
      (entry) => entry.dataClass === "contact_plaintext",
    );
    const diditContact = hostedAuthDataClasses.find(
      (entry) => entry.dataClass === "contact_provider_record",
    );

    assert.deepEqual(powerOtpContact?.modes, ["powerotp_pii"]);
    assert.equal(powerOtpContact?.clientExposure, "none");
    assert.deepEqual(diditContact?.modes, ["didit_pii"]);
    assert.equal(diditContact?.clientExposure, "none");
  });
});

describe("HostedAuthContactCustodySchema", () => {
  it("accepts the exact no-fallback custody routes", () => {
    hostedAuthContactCustody.forEach((custody) => {
      assert.equal(HostedAuthContactCustodySchema.safeParse(custody).success, true);
    });
  });

  it("rejects cross-mode stores, authenticators, and fallback", () => {
    for (const invalid of [
      {
        ...hostedAuthContactCustody[0],
        recoverableContactStore: "didit_user_only",
      },
      {
        ...hostedAuthContactCustody[1],
        contactAuthenticator: "powerotp_providers",
      },
      {
        ...hostedAuthContactCustody[1],
        providerFallbackAcrossModes: true,
      },
    ]) {
      assert.equal(HostedAuthContactCustodySchema.safeParse(invalid).success, false);
    }
  });
});

describe("HostedAuthTrustBoundarySchema", () => {
  it("accepts the canonical trust boundary", () => {
    assert.equal(
      HostedAuthTrustBoundarySchema.safeParse(hostedAuthTrustBoundary).success,
      true,
    );
  });

  it("rejects client reset authority, cross-scope access, and database-only decryption", () => {
    for (const invalid of [
      { ...hostedAuthTrustBoundary, clientAuthorizedRecoveryOrReset: true },
      { ...hostedAuthTrustBoundary, crossProjectAccess: "allow" },
      { ...hostedAuthTrustBoundary, crossRealmCredentialUse: "allow" },
      { ...hostedAuthTrustBoundary, databaseOnlyDecryption: true },
      { ...hostedAuthTrustBoundary, privilegedSupportCredentialMutation: true },
    ]) {
      assert.equal(
        HostedAuthTrustBoundarySchema.safeParse(invalid).success,
        false,
      );
    }
  });
});

describe("HostedAuthAbuseCaseSetSchema", () => {
  it("locks the complete canonical abuse-case set", () => {
    assert.equal(
      HostedAuthAbuseCaseSetSchema.safeParse(hostedAuthAbuseCases).success,
      true,
    );
    assert.equal(
      HostedAuthAbuseCaseSetSchema.safeParse(hostedAuthAbuseCases.slice(1))
        .success,
      false,
    );
    assert.equal(
      HostedAuthAbuseCaseSetSchema.safeParse([
        ...hostedAuthAbuseCases.slice(0, -1),
        "support_override",
      ]).success,
      false,
    );
  });
});
