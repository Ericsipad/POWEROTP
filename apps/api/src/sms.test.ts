import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createVoipMsSmsService, SmsProviderError } from "./sms.js";

const config = {
  VOIPMS_SMS_API_USERNAME: "api@example.com",
  VOIPMS_SMS_API_PASSWORD: "test-password",
  TRUNK1_DID: "+15551230000",
};

describe("VoIP.ms SMS service", () => {
  it("sends the code as multipart/form-data POST without credentials in the URL", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const service = createVoipMsSmsService(config, async (input, init) => {
      request = { url: String(input), init };
      return Response.json({ status: "success", sms: "12345" });
    });

    await service!.sendVerificationCode("+15551234567", "04219");

    assert.equal(request!.url, "https://voip.ms/api/v1/rest.php");
    assert.equal(request!.init?.method, "POST");
    // Deliberately FormData (multipart/form-data), not URLSearchParams —
    // VoIP.ms's REST endpoint returns a 500 SOAP fault for a
    // application/x-www-form-urlencoded POST body (live-confirmed).
    const body = request!.init?.body as FormData;
    assert.ok(body instanceof FormData);
    assert.equal(body.get("api_username"), config.VOIPMS_SMS_API_USERNAME);
    assert.equal(body.get("api_password"), config.VOIPMS_SMS_API_PASSWORD);
    assert.equal(body.get("did"), config.TRUNK1_DID);
    assert.equal(body.get("dst"), "+15551234567");
    assert.match(String(body.get("message")), /04219/);
    assert.equal(
      request!.init && "content-type" in (request!.init.headers as Record<string, string>),
      false,
    );
  });

  it("returns no service until all dedicated credentials and at least one DID are configured", () => {
    assert.equal(createVoipMsSmsService({}), undefined);
    assert.equal(
      createVoipMsSmsService({
        VOIPMS_SMS_API_USERNAME: "api@example.com",
        VOIPMS_SMS_API_PASSWORD: "test-password",
      }),
      undefined,
    );
  });

  it("normalizes provider rejection without exposing its response", async () => {
    const service = createVoipMsSmsService(config, async () =>
      Response.json({ status: "invalid_credentials" }),
    );

    await assert.rejects(
      service!.sendVerificationCode("+15551234567", "12345"),
      (error: unknown) =>
        error instanceof SmsProviderError && error.reasonCode === "provider_rejected",
    );
  });

  it("normalizes network and invalid-response failures", async () => {
    const networkFailure = createVoipMsSmsService(config, async () => {
      throw new Error("network failure");
    });
    const invalidResponse = createVoipMsSmsService(config, async () =>
      new Response("not json"),
    );

    for (const service of [networkFailure!, invalidResponse!]) {
      await assert.rejects(
        service.sendVerificationCode("+15551234567", "12345"),
        (error: unknown) =>
          error instanceof SmsProviderError &&
          error.reasonCode === "provider_unavailable",
      );
    }
  });

  it("rotates round-robin across every configured TRUNKn_DID", async () => {
    const multiDidConfig = {
      VOIPMS_SMS_API_USERNAME: "api@example.com",
      VOIPMS_SMS_API_PASSWORD: "test-password",
      TRUNK1_DID: "+15551230001",
      TRUNK2_DID: "+15551230002",
    };
    const usedDids: string[] = [];
    const service = createVoipMsSmsService(multiDidConfig, async (_input, init) => {
      usedDids.push(String((init?.body as FormData).get("did")));
      return Response.json({ status: "success", sms: "12345" });
    });

    await service!.sendVerificationCode("+15551234567", "11111");
    await service!.sendVerificationCode("+15551234567", "22222");
    await service!.sendVerificationCode("+15551234567", "33333");

    assert.deepEqual(usedDids, ["+15551230001", "+15551230002", "+15551230001"]);
  });

  it("falls over to the next configured DID when a send is rejected", async () => {
    const multiDidConfig = {
      VOIPMS_SMS_API_USERNAME: "api@example.com",
      VOIPMS_SMS_API_PASSWORD: "test-password",
      TRUNK1_DID: "+15551230001",
      TRUNK2_DID: "+15551230002",
    };
    const attempts: string[] = [];
    const service = createVoipMsSmsService(multiDidConfig, async (_input, init) => {
      const did = String((init?.body as FormData).get("did"));
      attempts.push(did);
      return did === "+15551230001"
        ? Response.json({ status: "invalid_did" })
        : Response.json({ status: "success", sms: "12345" });
    });

    await service!.sendVerificationCode("+15551234567", "12345");

    assert.deepEqual(attempts, ["+15551230001", "+15551230002"]);
  });

  it("fails closed once every configured DID has been tried", async () => {
    const multiDidConfig = {
      VOIPMS_SMS_API_USERNAME: "api@example.com",
      VOIPMS_SMS_API_PASSWORD: "test-password",
      TRUNK1_DID: "+15551230001",
      TRUNK2_DID: "+15551230002",
    };
    const service = createVoipMsSmsService(multiDidConfig, async () =>
      Response.json({ status: "invalid_did" }),
    );

    await assert.rejects(
      service!.sendVerificationCode("+15551234567", "12345"),
      (error: unknown) =>
        error instanceof SmsProviderError && error.reasonCode === "provider_rejected",
    );
  });
});
