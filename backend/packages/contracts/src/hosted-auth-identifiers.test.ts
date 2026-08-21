import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DiditInternalIdSchema,
  HostedAuthPollTokenSchema,
  HostedAuthProfileIdSchema,
  HostedAuthRequestIdSchema,
  HostedPersonIdentityIdSchema,
  PotpDiditIdSchema,
  ProjectIdentityBindingIdSchema,
  ProjectUserIdSchema,
  type HostedAuthRequestId,
  type HostedPersonIdentityId,
} from "./hosted-auth-identifiers.js";

const canonicalBody = "A".repeat(42) + "E";

const purposeSpecificIdentifiers = [
  ["hpi", HostedPersonIdentityIdSchema],
  ["hap", HostedAuthProfileIdSchema],
  ["pib", ProjectIdentityBindingIdSchema],
  ["pusr", ProjectUserIdSchema],
  ["pdi", PotpDiditIdSchema],
  ["har", HostedAuthRequestIdSchema],
  ["hpt", HostedAuthPollTokenSchema],
] as const;

describe("hosted-auth POWEROTP identifier schemas", () => {
  it("accepts each canonical purpose-specific 256-bit representation", () => {
    for (const [prefix, schema] of purposeSpecificIdentifiers) {
      assert.equal(schema.safeParse(`${prefix}_${canonicalBody}`).success, true);
    }
  });

  it("rejects cross-type substitution at runtime", () => {
    for (const [expectedPrefix, schema] of purposeSpecificIdentifiers) {
      for (const [actualPrefix] of purposeSpecificIdentifiers) {
        assert.equal(
          schema.safeParse(`${actualPrefix}_${canonicalBody}`).success,
          actualPrefix === expectedPrefix,
        );
      }
    }
  });

  it("rejects enumerable, malformed, padded, and non-canonical values", () => {
    for (const [prefix, schema] of purposeSpecificIdentifiers) {
      for (const invalid of [
        `${prefix}_1`,
        `${prefix}_${canonicalBody}=`,
        `${prefix}_${"A".repeat(42)}B`,
        `${prefix.toUpperCase()}_${canonicalBody}`,
        `${prefix}-${canonicalBody}`,
      ]) {
        assert.equal(schema.safeParse(invalid).success, false);
      }
    }
  });

  it("keeps branded identifier types non-interchangeable at compile time", () => {
    const personId = HostedPersonIdentityIdSchema.parse(
      `hpi_${canonicalBody}`,
    );
    const requestId = HostedAuthRequestIdSchema.parse(`har_${canonicalBody}`);

    const acceptPersonId = (_value: HostedPersonIdentityId) => undefined;
    const acceptRequestId = (_value: HostedAuthRequestId) => undefined;

    acceptPersonId(personId);
    acceptRequestId(requestId);
    // @ts-expect-error -- request IDs cannot substitute for private person IDs.
    acceptPersonId(requestId);
    // @ts-expect-error -- private person IDs cannot substitute for request IDs.
    acceptRequestId(personId);
  });
});

describe("DiditInternalIdSchema", () => {
  it("accepts only canonical random Didit internal UUIDs", () => {
    assert.equal(
      DiditInternalIdSchema.safeParse(
        "2f1c2c6e-65cd-4a4c-8f4b-89d1b10d6e26",
      ).success,
      true,
    );
  });

  it("rejects sequential, wrong-version, non-canonical, and POWEROTP IDs", () => {
    for (const invalid of [
      "00000000-0000-0000-0000-000000000001",
      "2f1c2c6e-65cd-1a4c-8f4b-89d1b10d6e26",
      "2F1C2C6E-65CD-4A4C-8F4B-89D1B10D6E26",
      `pdi_${canonicalBody}`,
    ]) {
      assert.equal(DiditInternalIdSchema.safeParse(invalid).success, false);
    }
  });
});
