import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderPjsipTrunks } from "./pjsip-config.js";

describe("renderPjsipTrunks", () => {
  it("renders a registration/auth/aor/endpoint/identify block per configured trunk", () => {
    const rendered = renderPjsipTrunks({
      nodeId: "node_123456789",
      trunks: {
        call_reachability: { url: "sip.voip.ms", user: "sub1", pass: "secret1" },
        voice_code: undefined,
        voice_challenge: undefined,
        sms_code: undefined,
      },
    });

    assert.match(rendered, /\[trunk-call-reachability\]/);
    assert.match(rendered, /type=registration/);
    assert.match(rendered, /type=auth/);
    assert.match(rendered, /type=aor/);
    assert.match(rendered, /type=endpoint/);
    assert.match(rendered, /type=identify/);
    assert.match(rendered, /username=sub1/);
    assert.match(rendered, /password=secret1/);
  });

  it("never leaks a trunk password for a method that has no configured trunk", () => {
    const rendered = renderPjsipTrunks({
      nodeId: "node_123456789",
      trunks: {
        call_reachability: undefined,
        voice_code: undefined,
        voice_challenge: undefined,
        sms_code: undefined,
      },
    });

    assert.doesNotMatch(rendered, /type=endpoint/);
    assert.match(rendered, /No outbound trunks are currently configured/);
  });
});
