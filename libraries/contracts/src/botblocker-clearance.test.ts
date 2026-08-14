import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type SignedSiteClearance,
  SignedSiteClearanceSchema,
  SiteClearanceSchema,
  type UnsignedSiteClearance,
  UnsignedSiteClearanceSchema,
} from "./botblocker-clearance.js";

function validClearance(): UnsignedSiteClearance {
  const now = Date.now();
  return {
    signatureStatus: "unsigned",
    siteId: "site_0123456789abcdef",
    gateSessionId: "gate_session_0123456789",
    audience: "https://customer.example",
    nonce: "nonce_0123456789abcdef",
    issuedAt: now,
    expiresAt: now + 180_000,
  };
}

function validSignedClearance(): SignedSiteClearance {
  const { signatureStatus: _signatureStatus, ...claims } = validClearance();
  return {
    ...claims,
    signatureStatus: "signed",
    keyId: "key_0000000000000001",
    signature: "A".repeat(86),
  };
}

describe("UnsignedSiteClearanceSchema", () => {
  it("accepts a valid unsigned clearance", () => {
    assert.equal(UnsignedSiteClearanceSchema.safeParse(validClearance()).success, true);
  });

  it("rejects expiresAt at or before issuedAt", () => {
    const now = Date.now();
    const clearance = { ...validClearance(), issuedAt: now, expiresAt: now };
    assert.equal(UnsignedSiteClearanceSchema.safeParse(clearance).success, false);
  });

  describe("reject-by-construction: unsigned must be structurally distinguishable from signed", () => {
    it("rejects a clearance carrying a forged signature field (and cannot be assigned at compile time)", () => {
      const valid = validClearance();

      // @ts-expect-error -- an unsigned clearance must never be able to carry a signature field.
      const withSignature: UnsignedSiteClearance = { ...valid, signature: "forged-signature" };

      assert.equal(UnsignedSiteClearanceSchema.safeParse(withSignature).success, false);
    });

    it("rejects a clearance carrying a forged keyId field (and cannot be assigned at compile time)", () => {
      const valid = validClearance();

      // @ts-expect-error -- an unsigned clearance must never be able to carry a signing key id.
      const withKeyId: UnsignedSiteClearance = { ...valid, keyId: "key_0000000000000001" };

      assert.equal(UnsignedSiteClearanceSchema.safeParse(withKeyId).success, false);
    });

    it("requires key metadata and a signature when signatureStatus is signed", () => {
      assert.equal(
        SiteClearanceSchema.safeParse({ ...validClearance(), signatureStatus: "signed" }).success,
        false,
      );
    });

    it("rejects an arbitrary signatureStatus value", () => {
      const result = SiteClearanceSchema.safeParse({
        ...validClearance(),
        signatureStatus: "self_attested",
      });
      assert.equal(result.success, false);
    });
  });
});

describe("SiteClearanceSchema", () => {
  it("accepts a valid unsigned clearance through the discriminated union", () => {
    assert.equal(SiteClearanceSchema.safeParse(validClearance()).success, true);
  });

  it("accepts a structurally valid signed clearance", () => {
    assert.equal(SignedSiteClearanceSchema.safeParse(validSignedClearance()).success, true);
    assert.equal(SiteClearanceSchema.safeParse(validSignedClearance()).success, true);
  });

  it("has unsigned and signed members", () => {
    assert.equal(SiteClearanceSchema.options.length, 2);
  });
});
