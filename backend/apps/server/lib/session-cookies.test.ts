import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { csrfCookieOptions, sessionCookieOptions } from "./cookie-options.js";

describe("backend session cookies", () => {
  it("keeps credentials host-only and same-site", () => {
    const expires = new Date("2030-01-01T00:00:00.000Z");
    const session = sessionCookieOptions(expires);
    const csrf = csrfCookieOptions(expires);

    assert.deepEqual(session, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      expires,
    });
    assert.deepEqual(csrf, {
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "strict",
      expires,
    });
    assert.equal("domain" in session, false);
    assert.equal("domain" in csrf, false);
  });
});
