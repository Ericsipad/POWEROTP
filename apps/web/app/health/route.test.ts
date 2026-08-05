import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "./route.js";

describe("GET /health", () => {
  it("reports a healthy service without touching the database", async () => {
    const response = GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.service, "powerotp");
    assert.equal(body.status, "ok");
  });
});
