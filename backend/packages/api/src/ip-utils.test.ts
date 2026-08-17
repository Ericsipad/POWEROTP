import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  encodeIpForRangeLookup,
  ipFamily,
  ipv4ToUint32,
  ipv6ToFixedWidthHex,
  normalizeIp,
} from "./ip-utils.js";

describe("normalizeIp", () => {
  it("passes through a valid IPv4 address", () => {
    assert.equal(normalizeIp("203.0.113.5"), "203.0.113.5");
  });

  it("strips an IPv4-mapped IPv6 prefix", () => {
    assert.equal(normalizeIp("::ffff:203.0.113.5"), "203.0.113.5");
  });

  it("lowercases and normalizes an IPv6 address", () => {
    assert.equal(normalizeIp("2001:0DB8::1"), "2001:db8::1");
  });

  it("returns undefined for anything else", () => {
    assert.equal(normalizeIp("not-an-ip"), undefined);
    assert.equal(normalizeIp("999.999.999.999"), undefined);
  });
});

describe("ipFamily", () => {
  it("classifies v4 and v6", () => {
    assert.equal(ipFamily("203.0.113.5"), "v4");
    assert.equal(ipFamily("2001:db8::1"), "v6");
  });

  it("returns undefined for an invalid value", () => {
    assert.equal(ipFamily("not-an-ip"), undefined);
  });
});

describe("ipv4ToUint32", () => {
  it("converts each corner of the address space", () => {
    assert.equal(ipv4ToUint32("0.0.0.0"), 0);
    assert.equal(ipv4ToUint32("255.255.255.255"), 4_294_967_295);
    assert.equal(ipv4ToUint32("203.0.113.5"), 203 * 2 ** 24 + 0 * 2 ** 16 + 113 * 2 ** 8 + 5);
  });

  it("preserves ordering between adjacent addresses", () => {
    const first = ipv4ToUint32("203.0.113.5")!;
    const second = ipv4ToUint32("203.0.113.6")!;
    assert.ok(second > first);
  });

  it("returns undefined for a malformed address", () => {
    assert.equal(ipv4ToUint32("2001:db8::1"), undefined);
    assert.equal(ipv4ToUint32("999.0.0.1"), undefined);
  });
});

/** Builds the expected fixed-width hex value from an explicit list of the
 * eight 16-bit groups, so each assertion's expected value is legible
 * (rather than an opaque 32-character literal) without re-implementing
 * the compression/expansion logic under test. */
function fromGroups(groups: string[]): string {
  return groups.map((group) => group.padStart(4, "0")).join("");
}

describe("ipv6ToFixedWidthHex", () => {
  it("expands the unspecified and loopback addresses", () => {
    assert.equal(ipv6ToFixedWidthHex("::"), fromGroups(["0", "0", "0", "0", "0", "0", "0", "0"]));
    assert.equal(ipv6ToFixedWidthHex("::1"), fromGroups(["0", "0", "0", "0", "0", "0", "0", "1"]));
  });

  it("expands compression at the start, middle, and end", () => {
    assert.equal(
      ipv6ToFixedWidthHex("2001:db8::1"),
      fromGroups(["2001", "db8", "0", "0", "0", "0", "0", "1"]),
    );
    assert.equal(
      ipv6ToFixedWidthHex("2001:db8::"),
      fromGroups(["2001", "db8", "0", "0", "0", "0", "0", "0"]),
    );
  });

  it("expands an embedded IPv4 tail", () => {
    assert.equal(
      ipv6ToFixedWidthHex("64:ff9a::192.0.2.1"),
      fromGroups(["64", "ff9a", "0", "0", "0", "0", "c000", "201"]),
    );
  });

  it("expands a fully written address with no compression", () => {
    assert.equal(
      ipv6ToFixedWidthHex("2001:db8:0:0:0:0:0:1"),
      fromGroups(["2001", "db8", "0", "0", "0", "0", "0", "1"]),
    );
  });

  it("sorts lexicographically the same as numeric magnitude", () => {
    const lower = ipv6ToFixedWidthHex("2001:db8::1")!;
    const higher = ipv6ToFixedWidthHex("2001:db8::2")!;
    assert.ok(higher > lower);
    const crossGroup = ipv6ToFixedWidthHex("2001:db8::1:0")!;
    assert.ok(crossGroup > higher);
  });

  it("returns undefined for a malformed address", () => {
    assert.equal(ipv6ToFixedWidthHex("203.0.113.5"), undefined);
    assert.equal(ipv6ToFixedWidthHex("2001:db8:::1"), undefined);
  });
});

describe("encodeIpForRangeLookup", () => {
  it("encodes a v4 address as its uint32 value", () => {
    assert.deepEqual(encodeIpForRangeLookup("203.0.113.5"), {
      family: "v4",
      value: ipv4ToUint32("203.0.113.5"),
    });
  });

  it("encodes a v6 address as its fixed-width hex value", () => {
    assert.deepEqual(encodeIpForRangeLookup("2001:db8::1"), {
      family: "v6",
      value: ipv6ToFixedWidthHex("2001:db8::1"),
    });
  });

  it("normalizes an IPv4-mapped v6 address to v4", () => {
    assert.deepEqual(encodeIpForRangeLookup("::ffff:203.0.113.5"), {
      family: "v4",
      value: ipv4ToUint32("203.0.113.5"),
    });
  });

  it("returns undefined for an invalid IP", () => {
    assert.equal(encodeIpForRangeLookup("not-an-ip"), undefined);
  });
});
