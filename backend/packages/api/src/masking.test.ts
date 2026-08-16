import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maskE164, maskEmail, maskTarget } from "./masking.js";

describe("maskE164", () => {
  it("keeps only the last two digits visible", () => {
    assert.equal(maskE164("+15551234567"), "+•••••••••67");
  });

  it("keeps the leading plus sign", () => {
    assert.equal(maskE164("+447911123456").startsWith("+"), true);
  });
});

describe("maskEmail", () => {
  it("keeps the first character of the local part and the whole domain", () => {
    assert.equal(maskEmail("jsmith@example.com"), "j•••••@example.com");
  });

  it("still masks a single-character local part", () => {
    assert.equal(maskEmail("a@example.com"), "a•@example.com");
  });
});

describe("maskTarget", () => {
  it("masks email_code targets as an email address", () => {
    assert.equal(maskTarget("email_code", "jsmith@example.com"), "j•••••@example.com");
  });

  it("masks every other type as an E.164 number", () => {
    assert.equal(maskTarget("sms_code", "+15551234567"), "+•••••••••67");
  });
});
