import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchVoipMsCdr,
  fetchVoipMsSms,
  numbersLikelyMatch,
  reconciliationWindow,
  VoipMsBillingError,
} from "./voipms-billing-client.js";

const config = {
  VOIPMS_SMS_API_USERNAME: "api@example.com",
  VOIPMS_SMS_API_PASSWORD: "test-password",
};

describe("reconciliationWindow", () => {
  it("widens by a day on each side to cover a UTC-midnight boundary", () => {
    const window = reconciliationWindow(new Date("2026-08-08T00:05:00.000Z"));
    assert.deepEqual(window, { dateFrom: "2026-08-07", dateTo: "2026-08-09" });
  });
});

describe("numbersLikelyMatch", () => {
  it("matches regardless of a leading + or missing country code", () => {
    assert.equal(numbersLikelyMatch("+14034701805", "14034701805"), true);
    assert.equal(numbersLikelyMatch("+14034701805", "4034701805"), true);
  });

  it("rejects genuinely different numbers", () => {
    assert.equal(numbersLikelyMatch("+14034701805", "+15005550006"), false);
  });
});

describe("fetchVoipMsCdr", () => {
  it("posts the expected params and returns the cdr rows on success", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const rows = await fetchVoipMsCdr(
      config,
      { dateFrom: "2026-08-07", dateTo: "2026-08-09" },
      async (input, init) => {
        request = { url: String(input), init };
        return Response.json({ status: "success", cdr: [{ destination: "14034701805" }] });
      },
    );

    const body = request!.init?.body as FormData;
    assert.equal(body.get("method"), "getCDR");
    assert.equal(body.get("api_username"), config.VOIPMS_SMS_API_USERNAME);
    assert.equal(body.get("date_from"), "2026-08-07");
    assert.equal(body.get("date_to"), "2026-08-09");
    assert.deepEqual(rows, [{ destination: "14034701805" }]);
  });

  it("returns an empty array on a day with no calls rather than throwing", async () => {
    const rows = await fetchVoipMsCdr(
      config,
      { dateFrom: "2026-08-07", dateTo: "2026-08-09" },
      async () => Response.json({ status: "no_cdr" }),
    );
    assert.deepEqual(rows, []);
  });

  it("throws when credentials are not configured", async () => {
    await assert.rejects(
      fetchVoipMsCdr({}, { dateFrom: "2026-08-07", dateTo: "2026-08-09" }),
      (error: unknown) => error instanceof VoipMsBillingError && error.reasonCode === "not_configured",
    );
  });

  it("normalizes a network failure to provider_unavailable", async () => {
    await assert.rejects(
      fetchVoipMsCdr(config, { dateFrom: "2026-08-07", dateTo: "2026-08-09" }, async () => {
        throw new Error("network down");
      }),
      (error: unknown) =>
        error instanceof VoipMsBillingError && error.reasonCode === "provider_unavailable",
    );
  });
});

describe("fetchVoipMsSms", () => {
  it("posts the did and date range and returns the sms rows on success", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const rows = await fetchVoipMsSms(
      config,
      "+15559990000",
      { dateFrom: "2026-08-07", dateTo: "2026-08-09" },
      async (input, init) => {
        request = { url: String(input), init };
        return Response.json({ status: "success", sms: [{ contact: "14034701805" }] });
      },
    );

    const body = request!.init?.body as FormData;
    assert.equal(body.get("method"), "getSMS");
    assert.equal(body.get("did"), "+15559990000");
    assert.deepEqual(rows, [{ contact: "14034701805" }]);
  });
});
