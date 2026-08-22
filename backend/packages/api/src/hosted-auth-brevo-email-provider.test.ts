import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedAuthContactScopeSchema,
  HostedAuthProviderEvidenceReferenceSchema,
  HostedAuthProviderOperationIdSchema,
  HostedAuthRequestIdSchema,
  hostedAuthRealms,
  type HostedAuthContactPurpose,
} from "@powerotp/contracts";

import {
  HostedAuthBrevoEmailProvider,
  HostedAuthEmailRoutingError,
  type HostedAuthEmailChallengeAuthority,
} from "./hosted-auth-brevo-email-provider.js";
import type {
  EmailOtpBranding,
  EmailOtpDeliveryContext,
  EmailOtpService,
} from "./email-otp-service.js";

const authRequestId = HostedAuthRequestIdSchema.parse(
  `har_${"A".repeat(43)}`,
);
const providerOperationId = HostedAuthProviderOperationIdSchema.parse(
  "hosted_email_operation_0001",
);
const evidenceReference = HostedAuthProviderEvidenceReferenceSchema.parse(
  "hosted_email_evidence_0001",
);

function scope(
  providerPurpose: HostedAuthContactPurpose,
  mode: "powerotp_pii" | "didit_pii" = "powerotp_pii",
) {
  return HostedAuthContactScopeSchema.parse({
    projectId: "project_scope_0001",
    realm: hostedAuthRealms[mode],
    flow:
      providerPurpose === "signin_contact_authentication" ||
      providerPurpose === "recovery_contact_proof"
        ? "signin"
        : "signup",
    providerPurpose,
  });
}

describe("hosted-auth Brevo email provider", () => {
  it("tags every hosted-auth delivery with its exact provider purpose", async () => {
    const deliveries: Array<{
      destination: string;
      code: string;
      branding?: EmailOtpBranding;
      context?: EmailOtpDeliveryContext;
    }> = [];
    const issued: Array<{ purpose: string; code: string }> = [];
    const email: EmailOtpService = {
      async sendOtpCode(destination, code, branding, context) {
        deliveries.push({ destination, code, branding, context });
      },
    };
    const challenges: HostedAuthEmailChallengeAuthority = {
      async issue(input) {
        issued.push({
          purpose: input.scope.providerPurpose,
          code: input.code,
        });
        return providerOperationId;
      },
      async verifyAndConsume() {
        return { status: "rejected" };
      },
    };
    const provider = new HostedAuthBrevoEmailProvider(
      email,
      challenges,
      async () => ({ brandName: "Acme" }),
    );
    const purposes: HostedAuthContactPurpose[] = [
      "signup_contact_enrollment",
      "signin_contact_authentication",
      "recovery_contact_proof",
      "cross_realm_link_contact_proof",
    ];

    for (const providerPurpose of purposes) {
      const result = await provider.startChallenge({
        authRequestId,
        scope: scope(providerPurpose),
        provider: "powerotp_email",
        destination: "person@example.com",
      });
      assert.equal(result.scope.providerPurpose, providerPurpose);
      assert.equal(result.providerOperationId, providerOperationId);
    }

    assert.deepEqual(
      deliveries.map((delivery) => delivery.context?.purpose),
      purposes.map((purpose) => `hosted_auth_${purpose}`),
    );
    assert.deepEqual(
      issued.map((challenge) => challenge.purpose),
      purposes,
    );
    assert.equal(
      issued.every((challenge, index) => challenge.code === deliveries[index]?.code),
      true,
    );
    assert.equal(
      deliveries.every((delivery) => delivery.branding?.brandName === "Acme"),
      true,
    );
  });

  it("rejects didit_pii before branding, challenge, or Brevo work", async () => {
    let calls = 0;
    const provider = new HostedAuthBrevoEmailProvider(
      {
        async sendOtpCode() {
          calls += 1;
        },
      },
      {
        async issue() {
          calls += 1;
          return providerOperationId;
        },
        async verifyAndConsume() {
          calls += 1;
          return { status: "rejected" };
        },
      },
      async () => {
        calls += 1;
        return undefined;
      },
    );

    await assert.rejects(
      provider.startChallenge({
        authRequestId,
        scope: scope("signup_contact_enrollment", "didit_pii"),
        provider: "didit_email",
        destination: "person@example.com",
      }),
      HostedAuthEmailRoutingError,
    );
    assert.equal(calls, 0);
  });

  it("returns only normalized proof results bound to the exact request scope", async () => {
    const challengeScope = scope("signin_contact_authentication");
    let verifiedInput: Record<string, unknown> | undefined;
    const provider = new HostedAuthBrevoEmailProvider(
      { async sendOtpCode() {} },
      {
        async issue() {
          return providerOperationId;
        },
        async verifyAndConsume(input) {
          verifiedInput = input;
          return {
            status: "verified",
            minimalEvidenceReference: evidenceReference,
          };
        },
      },
      async () => undefined,
    );

    const result = await provider.verifyProof({
      authRequestId,
      scope: challengeScope,
      provider: "powerotp_email",
      destination: "person@example.com",
      providerOperationId,
      proof: "12345",
    });

    assert.equal(result.status, "verified");
    assert.equal(
      result.status === "verified" && result.minimalEvidenceReference,
      evidenceReference,
    );
    assert.deepEqual(verifiedInput, {
      authRequestId,
      scope: challengeScope,
      destination: "person@example.com",
      providerOperationId,
      proof: "12345",
    });
    assert.equal("destination" in result, false);
    assert.equal("proof" in result, false);
  });
});
