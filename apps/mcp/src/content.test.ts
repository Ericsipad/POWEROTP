import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildExample, buildModalSessionExample, getCapabilities, integrationOverview } from "./content.js";

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

  it("documents the real /v1-prefixed creation path", () => {
    assert.match(integrationOverview.creation, /^POST \/v1\/projects/);
  });
});

describe("buildModalSessionExample", () => {
  it("keeps credentials in server environment examples and never asks for a target number", () => {
    const example = buildModalSessionExample("typescript");

    assert.match(example, /process\.env\.POWEROTP_API_KEY/);
    assert.doesNotMatch(example, /targetNumber/);
  });

  it("produces a curl example that creates a modal session, not a direct verification", () => {
    const example = buildModalSessionExample("curl");

    assert.match(example, /modal-sessions/);
    assert.doesNotMatch(example, /\/verifications" /);
  });
});
