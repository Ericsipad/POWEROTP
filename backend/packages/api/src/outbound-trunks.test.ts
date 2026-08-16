import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allOutboundTrunks, allTrunkDids, hasAnyOutboundTrunk } from "./outbound-trunks.js";

describe("allOutboundTrunks", () => {
  it("returns every fully-configured trunk in numeric order", () => {
    const config = {
      TRUNK1_URL: "sip1.voip.ms",
      TRUNK1_USER: "sub1",
      TRUNK1_PASS: "pass1",
      TRUNK3_URL: "sip3.voip.ms",
      TRUNK3_USER: "sub3",
      TRUNK3_PASS: "pass3",
    };

    assert.deepEqual(allOutboundTrunks(config), [
      { id: "trunk-1", url: "sip1.voip.ms", user: "sub1", pass: "pass1" },
      { id: "trunk-3", url: "sip3.voip.ms", user: "sub3", pass: "pass3" },
    ]);
  });

  it("skips a trunk missing any of url/user/pass", () => {
    assert.deepEqual(
      allOutboundTrunks({ TRUNK2_URL: "sip2.voip.ms", TRUNK2_USER: "sub2" }),
      [],
    );
  });

  it("returns an empty array when nothing is configured", () => {
    assert.deepEqual(allOutboundTrunks({}), []);
  });

  it("never includes a trunk's DID in the node-facing shape, even when one is configured", () => {
    const [trunk] = allOutboundTrunks({
      TRUNK1_URL: "sip1.voip.ms",
      TRUNK1_USER: "sub1",
      TRUNK1_PASS: "pass1",
      TRUNK1_DID: "+15551230000",
    });

    assert.ok(trunk);
    assert.equal("did" in trunk, false);
  });
});

describe("allTrunkDids", () => {
  it("returns every configured TRUNKn_DID in numeric order", () => {
    assert.deepEqual(
      allTrunkDids({ TRUNK1_DID: "+15551230001", TRUNK3_DID: "+15551230003" }),
      ["+15551230001", "+15551230003"],
    );
  });

  it("includes a DID even when that trunk's url/user/pass are not configured", () => {
    assert.deepEqual(allTrunkDids({ TRUNK1_DID: "+15551230001" }), ["+15551230001"]);
  });

  it("returns an empty array when no DID is configured", () => {
    assert.deepEqual(allTrunkDids({}), []);
  });
});

describe("hasAnyOutboundTrunk", () => {
  it("is true once at least one trunk is fully configured", () => {
    assert.equal(
      hasAnyOutboundTrunk({ TRUNK1_URL: "sip1.voip.ms", TRUNK1_USER: "sub1", TRUNK1_PASS: "pass1" }),
      true,
    );
  });

  it("is false when no trunk is fully configured", () => {
    assert.equal(hasAnyOutboundTrunk({}), false);
  });
});
