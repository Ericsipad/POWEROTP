import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildExample, getCapabilities } from "./content.js";

describe("MCP integration content", () => {
  it("describes all four verification methods without project access", () => {
    const capabilities = getCapabilities();

    assert.equal(capabilities.verificationTypes.length, 4);
    assert.match(capabilities.mcpAccess, /no project/);
  });

  it("keeps credentials in server environment examples", () => {
    const example = buildExample("voice_code", "typescript");

    assert.match(example, /process\.env\.POWEROTP_API_KEY/);
    assert.doesNotMatch(example, /real-api-key/);
  });
});
