import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBrevoEmailOtpService, EmailOtpProviderError } from "./email-otp-service.js";

const config = { BREVO_API_KEY: "test-key", EMAIL_FROM: "noreply@powerotp.com" };

describe("Brevo email OTP service", () => {
  it("sends the code with a plain POWEROTP-branded template when no branding is given", async () => {
    let body: Record<string, unknown> | undefined;
    const service = createBrevoEmailOtpService(config, async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({});
    });

    await service.sendOtpCode("user@example.com", "12345");

    assert.equal((body!.sender as { name: string }).name, "POWEROTP");
    assert.equal((body!.to as Array<{ email: string }>)[0]?.email, "user@example.com");
    assert.match(String(body!.htmlContent), /12345/);
    assert.doesNotMatch(String(body!.htmlContent), /<img/);
  });

  it("brands the sender name, subject, and heading from the project's snapshot", async () => {
    let body: Record<string, unknown> | undefined;
    const service = createBrevoEmailOtpService(config, async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({});
    });

    await service.sendOtpCode("user@example.com", "54321", {
      brandName: "Acme Corp",
      brandLogoUrl: "https://acme.example/logo.png",
    });

    assert.equal((body!.sender as { name: string }).name, "Acme Corp");
    assert.match(String(body!.subject), /Acme Corp/);
    assert.match(String(body!.htmlContent), /https:\/\/acme\.example\/logo\.png/);
  });

  it("escapes an untrusted brand name before embedding it in HTML", async () => {
    let body: Record<string, unknown> | undefined;
    const service = createBrevoEmailOtpService(config, async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({});
    });

    await service.sendOtpCode("user@example.com", "12345", {
      brandName: '<script>alert("x")</script>',
    });

    assert.doesNotMatch(String(body!.htmlContent), /<script>/);
  });

  it("normalizes a rejected send without exposing Brevo's response", async () => {
    const service = createBrevoEmailOtpService(config, async () => new Response("", { status: 400 }));

    await assert.rejects(
      service.sendOtpCode("user@example.com", "12345"),
      (error: unknown) => error instanceof EmailOtpProviderError && error.reasonCode === "provider_rejected",
    );
  });

  it("normalizes a provider outage as provider_unavailable", async () => {
    const service = createBrevoEmailOtpService(config, async () => new Response("", { status: 502 }));

    await assert.rejects(
      service.sendOtpCode("user@example.com", "12345"),
      (error: unknown) => error instanceof EmailOtpProviderError && error.reasonCode === "provider_unavailable",
    );
  });
});
