import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { referralCodeFromCookie } from "./referral-cookie";

describe("referralCodeFromCookie", () => {
  it("normalizes a valid first-touch referral cookie", () => {
    assert.equal(
      referralCodeFromCookie("other=value; powerotp_referral=Partner-Code"),
      "partner-code",
    );
  });

  it("ignores malformed referral cookies so they cannot block signup", () => {
    assert.equal(referralCodeFromCookie("powerotp_referral=%"), undefined);
    assert.equal(referralCodeFromCookie("powerotp_referral=not_valid"), undefined);
  });
});
