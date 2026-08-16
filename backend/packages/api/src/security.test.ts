import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createFiveDigitCode,
  decryptString,
  encryptString,
  hashPassword,
  hashToken,
  safeEqual,
  verifyPassword,
} from "./security.js";

describe("security primitives", () => {
  const pepper = "test-pepper-with-at-least-32-characters!!";

  it("hashes passwords with Argon2id", async () => {
    const passwordHash = await hashPassword("Correct-Horse-123", pepper);
    assert.equal(await verifyPassword(passwordHash, "Correct-Horse-123", pepper), true);
    assert.equal(await verifyPassword(passwordHash, "Wrong-Horse-123", pepper), false);
  });

  it("rejects a correct password hashed/verified with a different pepper", async () => {
    const passwordHash = await hashPassword("Correct-Horse-123", pepper);
    assert.equal(
      await verifyPassword(passwordHash, "Correct-Horse-123", "a-completely-different-pepper-value"),
      false,
    );
  });

  it("encrypts sensitive configuration with authenticated encryption", () => {
    const encrypted = encryptString(
      "provider-secret",
      "configuration-key-with-at-least-32-characters",
    );
    assert.notEqual(encrypted, "provider-secret");
    assert.equal(
      decryptString(
        encrypted,
        "configuration-key-with-at-least-32-characters",
      ),
      "provider-secret",
    );
  });

  it("creates stable keyed hashes and constant-time comparisons", () => {
    const hash = hashToken("session-token", "hash-key-with-at-least-32-characters");
    assert.equal(
      safeEqual(
        hash,
        hashToken("session-token", "hash-key-with-at-least-32-characters"),
      ),
      true,
    );
  });

  it("generates a zero-padded five-digit code", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = createFiveDigitCode();
      assert.match(code, /^\d{5}$/);
    }
  });
});
