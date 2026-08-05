import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildApp } from "./app.js";

const app = buildApp();

after(async () => {
  await app.close();
});

describe("API health", () => {
  it("reports a healthy service", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().service, "powerotp-api");
    assert.equal(response.json().status, "ok");
  });
});

describe("API readiness", () => {
  it("reports unavailable dependencies without claiming readiness", async () => {
    const unavailableApp = buildApp({
      async isReady() {
        return false;
      },
    });

    const response = await unavailableApp.inject({ method: "GET", url: "/ready" });
    await unavailableApp.close();

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().status, "unavailable");
  });
});
