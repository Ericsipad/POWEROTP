import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalizeIpCidr,
  InvalidIpCidrError,
  isIpAllowed,
} from "./ip-cidr.js";

describe("project backend CIDR policy", () => {
  it("canonicalizes IPv4 and IPv6 networks", () => {
    assert.equal(canonicalizeIpCidr("203.0.113.129/24"), "203.0.113.0/24");
    assert.equal(
      canonicalizeIpCidr("2001:0DB8:0001:0000:0000:0000:0000:1234/48"),
      "2001:db8:1::/48",
    );
    assert.equal(canonicalizeIpCidr("0.0.0.0/0"), "0.0.0.0/0");
    assert.equal(canonicalizeIpCidr("::/0"), "::/0");
  });

  it("rejects malformed, ambiguous, mapped, and alternate representations", () => {
    for (const value of [
      "203.0.113.1",
      "203.0.113.1/33",
      "203.0.113.01/24",
      "0xCB.0.0.1/32",
      "2130706433/32",
      "2001:db8::1/-1",
      "2001:db8::1/064",
      "2001:db8::1%eth0/64",
      "[2001:db8::1]/64",
      "::ffff:203.0.113.1/128",
      "::ffff:cb00:7101/128",
      "::203.0.113.1/128",
      "2001:db8:0:0:0:0:0:1:/128",
    ]) {
      assert.throws(
        () => canonicalizeIpCidr(value),
        (error: unknown) => error instanceof InvalidIpCidrError,
        value,
      );
    }
  });

  it("matches only same-family addresses and fails closed on invalid sources", () => {
    const allowlist = ["203.0.113.0/24", "2001:db8:abcd::/48"];
    assert.equal(isIpAllowed("203.0.113.42", allowlist), true);
    assert.equal(isIpAllowed("203.0.114.42", allowlist), false);
    assert.equal(isIpAllowed("2001:db8:abcd::42", allowlist), true);
    assert.equal(isIpAllowed("2001:db8:abce::42", allowlist), false);
    assert.equal(isIpAllowed("::ffff:203.0.113.42", allowlist), false);
    assert.equal(isIpAllowed("203.0.113.042", allowlist), false);
    assert.equal(
      isIpAllowed("203.0.113.42", [...allowlist, "corrupt"]),
      false,
    );
    assert.equal(isIpAllowed(undefined, allowlist), false);
    assert.equal(isIpAllowed(undefined, []), true);
  });
});
