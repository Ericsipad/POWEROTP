import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { PowerOtpClient, verifyCallbackSignature } from "./index.js";

function signBody(body: string, secret: string, timestamp = Date.now()) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("base64url");
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyCallbackSignature", () => {
  const secret = "callback-signing-secret-with-32-plus-characters";
  const body = JSON.stringify({ event: { interactionId: "int_1" } });

  it("verifies a signature produced for the same body and secret", () => {
    const timestamp = Date.now();
    const header = signBody(body, secret, timestamp);
    assert.equal(verifyCallbackSignature(body, secret, header, timestamp), true);
  });

  it("rejects a tampered body", () => {
    const header = signBody(body, secret);
    assert.equal(verifyCallbackSignature(body.replace("int_1", "int_2"), secret, header), false);
  });

  it("rejects a signature outside the replay window", () => {
    const timestamp = Date.now() - 10 * 60 * 1_000;
    const header = signBody(body, secret, timestamp);
    assert.equal(verifyCallbackSignature(body, secret, header), false);
  });
});

function fakeFetch(response: { status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(response.body), { status: response.status });
  }) as typeof globalThis.fetch;
  return { fetchFn, calls };
}

describe("PowerOtpClient.createVerification", () => {
  it("posts to the configured project URL and returns the parsed response", async () => {
    const accepted = {
      interactionId: "int_0123456789abcdef",
      state: "queued",
      statusUrl: "https://powerotp.com/v1/verifications/int_0123456789abcdef",
      expiresAt: new Date().toISOString(),
    };
    const { fetchFn, calls } = fakeFetch({ status: 202, body: accepted });
    const client = new PowerOtpClient({
      apiKey: "potp_sk_test",
      projectUrl: "https://powerotp.com/v1/projects/demo/verifications",
      fetch: fetchFn,
    });

    const result = await client.createVerification(
      { type: "call_reachability", targetNumber: "+15551234567", browserResponse: false },
      "idem-key-1",
    );

    assert.equal(result.interactionId, accepted.interactionId);
    assert.equal(calls[0]!.url, "https://powerotp.com/v1/projects/demo/verifications");
  });

  it("requires an idempotency key", async () => {
    const { fetchFn } = fakeFetch({ status: 202, body: {} });
    const client = new PowerOtpClient({
      apiKey: "potp_sk_test",
      projectUrl: "https://powerotp.com/v1/projects/demo/verifications",
      fetch: fetchFn,
    });

    await assert.rejects(() =>
      client.createVerification(
        { type: "call_reachability", targetNumber: "+15551234567", browserResponse: false },
        "",
      ),
    );
  });
});

describe("PowerOtpClient.createModalSession", () => {
  it("posts to the sibling modal-sessions path of the configured project URL", async () => {
    const accepted = {
      sessionId: "mss_0123456789abcdef",
      modalUrl: "https://powerotp.com/widget/mss_0123456789abcdef",
      expiresAt: new Date().toISOString(),
    };
    const { fetchFn, calls } = fakeFetch({ status: 202, body: accepted });
    const client = new PowerOtpClient({
      apiKey: "potp_sk_test",
      projectUrl: "https://powerotp.com/v1/projects/demo/verifications",
      fetch: fetchFn,
    });

    const result = await client.createModalSession(["sms_code"]);

    assert.equal(result.sessionId, accepted.sessionId);
    assert.equal(calls[0]!.url, "https://powerotp.com/v1/projects/demo/modal-sessions");
  });
});

describe("PowerOtpClient.getVerificationStatus", () => {
  it("fetches the top-level verifications path on the project URL's origin", async () => {
    const status = {
      interactionId: "int_0123456789abcdef",
      type: "call_reachability",
      state: "succeeded",
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    };
    const { fetchFn, calls } = fakeFetch({ status: 200, body: status });
    const client = new PowerOtpClient({
      apiKey: "potp_sk_test",
      projectUrl: "https://powerotp.com/v1/projects/demo/verifications",
      fetch: fetchFn,
    });

    const result = await client.getVerificationStatus("int_0123456789abcdef");

    assert.equal(result.state, "succeeded");
    assert.equal(calls[0]!.url, "https://powerotp.com/v1/verifications/int_0123456789abcdef");
  });
});

describe("PowerOtpClient.submitResponse", () => {
  it("submits a code body as-is", async () => {
    const { fetchFn, calls } = fakeFetch({ status: 200, body: { succeeded: true } });
    const client = new PowerOtpClient({
      apiKey: "potp_sk_test",
      projectUrl: "https://powerotp.com/v1/projects/demo/verifications",
      fetch: fetchFn,
    });

    const result = await client.submitResponse("int_0123456789abcdef", { code: "12345" });

    assert.equal(result.succeeded, true);
    assert.equal(
      calls[0]!.url,
      "https://powerotp.com/v1/verifications/int_0123456789abcdef/response",
    );
  });
});
