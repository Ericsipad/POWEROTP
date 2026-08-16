import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { POWEROTP_PROXY_MATCHER } from "@powerotp/gate-next";

import { NEXTJS_PROXY_MATCHER_LITERAL } from "./nextjs.js";

describe("Next.js proxy matcher drift", () => {
  it("keeps the generated proxy.ts matcher identical to @powerotp/gate-next's own", () => {
    assert.equal(NEXTJS_PROXY_MATCHER_LITERAL, POWEROTP_PROXY_MATCHER);
  });
});
