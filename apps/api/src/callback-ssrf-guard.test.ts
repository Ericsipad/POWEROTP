import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isBlockedIpAddress } from "./callback-ssrf-guard.js";

describe("callback SSRF guard", () => {
  it("blocks loopback, private, link-local, and multicast IPv4 addresses", () => {
    assert.equal(isBlockedIpAddress("127.0.0.1"), true);
    assert.equal(isBlockedIpAddress("10.1.2.3"), true);
    assert.equal(isBlockedIpAddress("192.168.1.1"), true);
    assert.equal(isBlockedIpAddress("169.254.169.254"), true);
    assert.equal(isBlockedIpAddress("224.0.0.1"), true);
  });

  it("blocks IPv6 loopback and unique-local addresses", () => {
    assert.equal(isBlockedIpAddress("::1"), true);
    assert.equal(isBlockedIpAddress("fd00::1"), true);
    assert.equal(isBlockedIpAddress("fe80::1"), true);
  });

  it("allows public IPv4 addresses", () => {
    assert.equal(isBlockedIpAddress("8.8.8.8"), false);
    assert.equal(isBlockedIpAddress("93.184.216.34"), false);
  });
});
