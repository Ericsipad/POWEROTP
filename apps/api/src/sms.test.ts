import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createVoipMsSmsService, SmsProviderError } from "./sms.js";

const config = {
  VOIPMS_SMS_API_USERNAME: "api@example.com",
  VOIPMS_SMS_API_PASSWORD: "test-password",
  VOIPMS_SMS_DID: "+15551230000",
};

describe("VoIP.ms SMS service", () => {
  it("sends the code as POST form data without credentials in the URL", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const service = createVoipMsSmsService(config, async (input, init) => {
      request = { url: String(input), init };
      return Response.json({ status: "success", sms: "12345" });
    });

    await service!.sendVerificationCode("+15551234567", "04219");

    assert.equal(request!.url, "https://voip.ms/api/v1/rest.php");
    assert.equal(request!.init?.method, "POST");
    const body = new URLSearchParams(String(request!.init?.body));
    assert.equal(body.get("api_username"), config.VOIPMS_SMS_API_USERNAME);
    assert.equal(body.get("api_password"), config.VOIPMS_SMS_API_PASSWORD);
    assert.equal(body.get("did"), config.VOIPMS_SMS_DID);
    assert.equal(body.get("dst"), "+15551234567");
    assert.match(body.get("message")!, /04219/);
  });

  it("returns no service until all dedicated credentials are configured", () => {
    assert.equal(createVoipMsSmsService({}), undefined);
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
});
