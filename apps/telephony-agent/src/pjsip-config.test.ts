import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderPjsipTrunks } from "./pjsip-config.js";

describe("renderPjsipTrunks", () => {
  it("renders one block per configured trunk id", () => {
    const rendered = renderPjsipTrunks({
      trunks: [
        { id: "trunk-1", url: "sip.voip.ms", user: "sub1", pass: "secret1" },
        { id: "trunk-2", url: "sip2.voip.ms", user: "sub2", pass: "secret2" },
      ],
    });

    assert.match(rendered, /\[trunk-1\]/);
    assert.match(rendered, /\[trunk-2\]/);
    assert.match(rendered, /type=registration/);
    assert.match(rendered, /type=auth/);
    assert.match(rendered, /type=aor/);
    assert.match(rendered, /type=endpoint/);
    assert.match(rendered, /type=identify/);
    assert.match(rendered, /username=sub1/);
    assert.match(rendered, /password=secret1/);
    assert.match(rendered, /username=sub2/);
    assert.match(rendered, /password=secret2/);
  });

  it("never leaks a password for an unconfigured trunk slot", () => {
    const rendered = renderPjsipTrunks({ trunks: [] });

    assert.doesNotMatch(rendered, /type=endpoint/);
    assert.doesNotMatch(rendered, /password/);
    assert.match(rendered, /No outbound trunks are currently configured/);
  });
});
