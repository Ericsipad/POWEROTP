import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedAuthContactScopeSchema,
  HostedAuthRequestIdSchema,
  hostedAuthRealms,
  type HostedAuthContactPurpose,
} from "@powerotp/contracts";

import {
  HostedAuthDiditContactRejectedError,
  createHostedAuthDiditContactProviders,
  type HostedAuthDiditContactMappingResolver,
} from "./hosted-auth-didit-contact-provider.js";

const authRequestId = HostedAuthRequestIdSchema.parse(`har_${"A".repeat(43)}`);
const providerOperationId = "e39cb057-92fc-4b59-b84e-02fec29a0f24";
const mapping = {
  potpDiditId: `pdi_${"A".repeat(43)}`,
  diditInternalId: "2f1c2c6e-65cd-4a4c-8f4b-89d1b10d6e26",
};

function scope(providerPurpose: HostedAuthContactPurpose) {
  return HostedAuthContactScopeSchema.parse({
    projectId: "project_scope_0001",
    realm: hostedAuthRealms.didit_pii,
    flow:
      providerPurpose === "signin_contact_authentication" ||
      providerPurpose === "recovery_contact_proof"
        ? "signin"
        : "signup",
    providerPurpose,
  });
}

function resolver(onResolve: () => void = () => {}): HostedAuthDiditContactMappingResolver {
  return {
    async resolve() {
      onResolve();
      return mapping;
    },
  };
}

describe("hosted-auth Didit contact providers", () => {
  it("sends email and phone OTPs through POWEROTP-controlled UI contracts", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const providers = createHostedAuthDiditContactProviders(
      { DIDIT_API_KEY: "server-api-key" },
      resolver(),
      async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return Response.json({
          request_id: providerOperationId,
          status: "Success",
          vendor_data: mapping.potpDiditId,
        });
      },
    )!;

    const email = await providers.email.startChallenge({
      authRequestId,
      scope: scope("signup_contact_enrollment"),
      provider: "didit_email",
      destination: "person@example.com",
    });
    const phone = await providers.phone.startChallenge({
      authRequestId,
      scope: scope("signin_contact_authentication"),
      provider: "didit_phone",
      destination: "+15551234567",
    });

    assert.equal(email.providerOperationId, providerOperationId);
    assert.equal(phone.providerOperationId, providerOperationId);
    assert.deepEqual(calls, [
      {
        url: "https://verification.didit.me/v3/email/send/",
        body: {
          email: "person@example.com",
          options: {
            code_size: 6,
            locale: "en",
            use_white_label_customization: true,
          },
          vendor_data: mapping.potpDiditId,
        },
      },
      {
        url: "https://verification.didit.me/v3/phone/send/",
        body: {
          phone_number: "+15551234567",
          options: {
            code_size: 6,
            locale: "en",
            preferred_channel: "sms",
          },
          vendor_data: mapping.potpDiditId,
        },
      },
    ]);
  });

  it("checks proof with the transient destination and returns minimal evidence", async () => {
    const bodies: Record<string, unknown>[] = [];
    const providers = createHostedAuthDiditContactProviders(
      { DIDIT_API_KEY: "server-api-key" },
      resolver(),
      async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({
          request_id: providerOperationId,
          status: "Approved",
          vendor_data: mapping.potpDiditId,
          email: { email: "must-not-escape@example.com" },
        });
      },
    )!;
    const result = await providers.email.verifyProof({
      authRequestId,
      scope: scope("signin_contact_authentication"),
      provider: "didit_email",
      destination: "person@example.com",
      providerOperationId,
      proof: "123456",
    });

    assert.deepEqual(bodies, [{ email: "person@example.com", code: "123456" }]);
    assert.equal(result.status, "verified");
    assert.equal(
      result.status === "verified" && result.minimalEvidenceReference,
      providerOperationId,
    );
    assert.equal("destination" in result, false);
    assert.equal("email" in result, false);
  });

  it("binds every provider response to the permanent person-root mapping", async () => {
    let resolutions = 0;
    const providers = createHostedAuthDiditContactProviders(
      { DIDIT_API_KEY: "server-api-key" },
      resolver(() => {
        resolutions += 1;
      }),
      async () =>
        Response.json({
          request_id: providerOperationId,
          status: "Success",
          vendor_data: `pdi_${"E".repeat(43)}`,
        }),
    )!;

    await assert.rejects(
      providers.email.startChallenge({
        authRequestId,
        scope: scope("signup_contact_enrollment"),
        provider: "didit_email",
        destination: "person@example.com",
      }),
      /different vendor data/,
    );
    assert.equal(resolutions, 1);
  });

  it("rejects a finalized proof for a different provider operation", async () => {
    const providers = createHostedAuthDiditContactProviders(
      { DIDIT_API_KEY: "server-api-key" },
      resolver(),
      async () =>
        Response.json({
          request_id: "2f1c2c6e-65cd-4a4c-8f4b-89d1b10d6e26",
          status: "Approved",
          vendor_data: mapping.potpDiditId,
        }),
    )!;

    await assert.rejects(
      providers.phone.verifyProof({
        authRequestId,
        scope: scope("signin_contact_authentication"),
        provider: "didit_phone",
        destination: "+15551234567",
        providerOperationId,
        proof: "123456",
      }),
      /different operation/,
    );
  });

  it("normalizes provider rejection, bad proof, and outages without false success", async () => {
    const check = async (response: Response, expected: string) => {
      const providers = createHostedAuthDiditContactProviders(
        { DIDIT_API_KEY: "server-api-key" },
        resolver(),
        async () => response,
      )!;
      const result = await providers.phone.verifyProof({
        authRequestId,
        scope: scope("signin_contact_authentication"),
        provider: "didit_phone",
        destination: "+15551234567",
        providerOperationId,
        proof: "123456",
      });
      assert.equal(result.status, expected);
    };

    await check(
      Response.json({
        request_id: providerOperationId,
        status: "Declined",
        vendor_data: mapping.potpDiditId,
      }),
      "declined",
    );
    await check(
      Response.json({
        request_id: "11111111-2222-4333-8444-555555555555",
        status: "Failed",
        vendor_data: mapping.potpDiditId,
      }),
      "rejected",
    );
    await check(new Response(null, { status: 503 }), "retryable_failure");
  });

  it("fails closed when delivery is blocked and stays disabled without credentials", async () => {
    const providers = createHostedAuthDiditContactProviders(
      { DIDIT_API_KEY: "server-api-key" },
      resolver(),
      async () =>
        Response.json({
          request_id: providerOperationId,
          status: "Blocked",
          vendor_data: mapping.potpDiditId,
        }),
    )!;
    await assert.rejects(
      providers.phone.startChallenge({
        authRequestId,
        scope: scope("signin_contact_authentication"),
        provider: "didit_phone",
        destination: "+15551234567",
      }),
      HostedAuthDiditContactRejectedError,
    );
    assert.equal(
      createHostedAuthDiditContactProviders({}, resolver()),
      undefined,
    );
  });
});
