import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BotBlockerEd25519SignatureSchema,
  canonicalizeBotBlockerArtifact,
} from "./botblocker-signing.js";

describe("canonicalizeBotBlockerArtifact", () => {
  it("produces identical bytes for equivalent object key orders", () => {
    const first = { siteId: "site_1", nested: { z: 1, a: [true, null] } };
    const second = { nested: { a: [true, null], z: 1 }, siteId: "site_1" };

    assert.equal(
      canonicalizeBotBlockerArtifact(first),
      canonicalizeBotBlockerArtifact(second),
    );
  });

  it("retains array order and rejects values JSON cannot sign safely", () => {
    assert.notEqual(
      canonicalizeBotBlockerArtifact({ values: [1, 2] }),
      canonicalizeBotBlockerArtifact({ values: [2, 1] }),
    );
    assert.throws(() => canonicalizeBotBlockerArtifact({ value: undefined }), TypeError);
    assert.throws(() => canonicalizeBotBlockerArtifact({ value: Number.NaN }), TypeError);
  });
});

describe("BotBlockerEd25519SignatureSchema", () => {
  it("accepts only unpadded 64-byte base64url signatures", () => {
    assert.equal(BotBlockerEd25519SignatureSchema.safeParse("A".repeat(86)).success, true);
    assert.equal(BotBlockerEd25519SignatureSchema.safeParse("A".repeat(85)).success, false);
    assert.equal(
      BotBlockerEd25519SignatureSchema.safeParse(`${"A".repeat(85)}=`).success,
      false,
    );
  });
});
