import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parsePjsipRegistrations } from "./pjsip-status.js";

// Real output captured from `asterisk -rx "pjsip show registrations"` on
// this project's droplet (Asterisk 20), not a guessed format — see
// `docs/AS_BUILT.md`'s "Admin operator health dashboard" section.
const REAL_SAMPLE_OUTPUT = `
 <Registration/ServerURI..............................>  <Auth....................>  <Status.......>
==========================================================================================

 trunk-1/sip:sanjose2.voip.ms                            trunk-1-auth                Registered        (exp. 1757s)
 trunk-2/sip:sanjose2.voip.ms                            trunk-2-auth                Rejected          (exp. 11906s ago)
 trunk-3/sip:sanjose2.voip.ms                            trunk-3-auth                Rejected          (exp. 11903s ago)
 trunk-4/sip:sanjose2.voip.ms                            trunk-4-auth                Registered        (exp. 1753s)

Objects found: 4
`;

describe("parsePjsipRegistrations", () => {
  it("parses every trunk row's registration state from real captured CLI output", () => {
    assert.deepEqual(parsePjsipRegistrations(REAL_SAMPLE_OUTPUT), [
      { id: "trunk-1", registrationState: "Registered" },
      { id: "trunk-2", registrationState: "Rejected" },
      { id: "trunk-3", registrationState: "Rejected" },
      { id: "trunk-4", registrationState: "Registered" },
    ]);
  });

  it("ignores header, separator, and summary lines", () => {
    const result = parsePjsipRegistrations(REAL_SAMPLE_OUTPUT);
    assert.equal(result.length, 4);
  });

  it("returns an empty list for empty or unrecognizable output", () => {
    assert.deepEqual(parsePjsipRegistrations(""), []);
    assert.deepEqual(parsePjsipRegistrations("Objects found: 0\n"), []);
  });

  it("reports an unknown status word as Unknown rather than dropping the row", () => {
    const result = parsePjsipRegistrations(
      " trunk-5/sip:example.voip.ms                            trunk-5-auth                Removed\n",
    );
    assert.deepEqual(result, [{ id: "trunk-5", registrationState: "Unknown" }]);
  });
});
