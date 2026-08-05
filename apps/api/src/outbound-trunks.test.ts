import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { outboundTrunkFor } from "./outbound-trunks.js";

describe("outboundTrunkFor", () => {
  it("resolves the dedicated trunk for each verification method", () => {
    const config = {
      OUTBOUND1_URL: "sip1.voip.ms",
      OUTBOUND1_USER: "sub1",
      OUTBOUND1_PASS: "pass1",
      OUTBOUND2_URL: "sip2.voip.ms",
      OUTBOUND2_USER: "sub2",
      OUTBOUND2_PASS: "pass2",
    };

    assert.deepEqual(outboundTrunkFor(config, "call_reachability"), {
      url: "sip1.voip.ms",
      user: "sub1",
      pass: "pass1",
    });
    assert.deepEqual(outboundTrunkFor(config, "voice_code"), {
      url: "sip2.voip.ms",
      user: "sub2",
      pass: "pass2",
    });
  });

  it("returns undefined when a trunk is not fully configured", () => {
    assert.equal(outboundTrunkFor({}, "sms_code"), undefined);
  });
});
