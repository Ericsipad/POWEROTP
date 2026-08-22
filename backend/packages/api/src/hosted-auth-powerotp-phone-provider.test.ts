import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedAuthContactScopeSchema,
  HostedAuthRequestIdSchema,
  hostedAuthRealms,
  type HostedAuthContactPurpose,
} from "@powerotp/contracts";
import type { Db } from "mongodb";

import {
  createHostedAuthPowerOtpPhoneProvider,
  HostedAuthPhoneRoutingError,
} from "./hosted-auth-powerotp-phone-provider.js";
import type { VerificationRequestDocument } from "./verification-persistence.js";
import { VerificationError } from "./verification-service.js";

const authRequestId = HostedAuthRequestIdSchema.parse(`har_${"A".repeat(43)}`);
const interactionId = "int_019c1234567890123456789012345678";

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

function fakeDb(onLookup: () => void = () => {}): Db {
  return {
    collection() {
      return {
        async findOne() {
          onLookup();
          return { customerId: "customer_scope_001" };
        },
      };
    },
  } as unknown as Db;
}

describe("hosted-auth POWEROTP phone providers", () => {
  it("maps every purpose to the existing real SMS or voice interaction", async () => {
    const created: Array<Record<string, unknown>> = [];
    const verifications = {
      async create(...args: unknown[]) {
        created.push({ args });
        return {
          interactionId,
          state: "queued" as const,
          statusUrl: "https://api.powerotp.com/v1/verifications/test",
          expiresAt: new Date().toISOString(),
        };
      },
      async get() {
        return null;
      },
      async submitCode() {
        return { succeeded: false };
      },
    };
    const sms = createHostedAuthPowerOtpPhoneProvider(
      "powerotp_sms",
      verifications,
      fakeDb(),
    );
    const voice = createHostedAuthPowerOtpPhoneProvider(
      "powerotp_voice",
      verifications,
      fakeDb(),
    );
    const purposes: HostedAuthContactPurpose[] = [
      "signup_contact_enrollment",
      "signin_contact_authentication",
      "recovery_contact_proof",
      "cross_realm_link_contact_proof",
    ];

    for (const providerPurpose of purposes) {
      for (const [provider, adapter] of [
        ["powerotp_sms", sms],
        ["powerotp_voice", voice],
      ] as const) {
        const result = await adapter.startChallenge({
          authRequestId,
          scope: scope(providerPurpose),
          provider,
          destination: "+15551234567",
        });
        assert.equal(result.scope.providerPurpose, providerPurpose);
        assert.equal(result.providerOperationId, interactionId);
      }
    }

    assert.deepEqual(
      created.map(({ args }) => {
        const values = args as unknown[];
        const input = values[2] as { type: string };
        const context = values[5] as {
          provider: string;
          scope: { providerPurpose: string };
        };
        return {
          type: input.type,
          provider: context.provider,
          purpose: context.scope.providerPurpose,
          correlationId: values[4],
        };
      }),
      purposes.flatMap((purpose) => [
        {
          type: "sms_code",
          provider: "powerotp_sms",
          purpose,
          correlationId: authRequestId,
        },
        {
          type: "voice_code",
          provider: "powerotp_voice",
          purpose,
          correlationId: authRequestId,
        },
      ]),
    );
  });

  it("rejects wrong custody or POWEROTP channel before any side effect", async () => {
    let calls = 0;
    const adapter = createHostedAuthPowerOtpPhoneProvider(
      "powerotp_sms",
      {
        async create() {
          calls += 1;
          throw new Error("unreachable");
        },
        async get() {
          calls += 1;
          return null;
        },
        async submitCode() {
          calls += 1;
          return { succeeded: false };
        },
      },
      fakeDb(() => {
        calls += 1;
      }),
    );

    await assert.rejects(
      adapter.startChallenge({
        authRequestId,
        scope: scope("signin_contact_authentication", "didit_pii"),
        provider: "didit_phone",
        destination: "+15551234567",
      }),
      HostedAuthPhoneRoutingError,
    );
    await assert.rejects(
      adapter.startChallenge({
        authRequestId,
        scope: scope("signin_contact_authentication"),
        provider: "powerotp_voice",
        destination: "+15551234567",
      }),
      HostedAuthPhoneRoutingError,
    );
    assert.equal(calls, 0);
  });

  it("consumes proof only for the exact stored request, scope, and provider", async () => {
    const challengeScope = scope("signin_contact_authentication");
    let submits = 0;
    const operation = {
      targetNumber: "+15551234567",
      hostedAuthContact: {
        authRequestId,
        scope: challengeScope,
        provider: "powerotp_sms" as const,
      },
    } as VerificationRequestDocument;
    const adapter = createHostedAuthPowerOtpPhoneProvider(
      "powerotp_sms",
      {
        async create() {
          throw new Error("unreachable");
        },
        async get() {
          return operation;
        },
        async submitCode(_id: string, proof: string) {
          submits += 1;
          return { succeeded: proof === "12345" };
        },
      },
      fakeDb(),
    );
    const request = {
      authRequestId,
      scope: challengeScope,
      provider: "powerotp_sms" as const,
      destination: "+15551234567",
      providerOperationId: interactionId,
      proof: "12345",
    };

    const wrongScope = await adapter.verifyProof({
      ...request,
      scope: scope("recovery_contact_proof"),
    });
    assert.equal(wrongScope.status, "rejected");
    assert.equal(submits, 0);

    const verified = await adapter.verifyProof(request);
    assert.equal(verified.status, "verified");
    assert.equal(
      verified.status === "verified" && verified.minimalEvidenceReference,
      interactionId,
    );
    assert.equal(submits, 1);
  });

  it("normalizes queued and replayed interaction states", async () => {
    const challengeScope = scope("signin_contact_authentication");
    const request = {
      authRequestId,
      scope: challengeScope,
      provider: "powerotp_voice" as const,
      destination: "+15551234567",
      providerOperationId: interactionId,
      proof: "12345",
    };
    const operation = {
      targetNumber: "+15551234567",
      hostedAuthContact: {
        authRequestId,
        scope: challengeScope,
        provider: "powerotp_voice" as const,
      },
    } as VerificationRequestDocument;
    for (const [code, expected] of [
      ["not_awaiting_response", "retryable_failure"],
      ["verification_already_resolved", "rejected"],
    ] as const) {
      const adapter = createHostedAuthPowerOtpPhoneProvider(
        "powerotp_voice",
        {
          async create() {
            throw new Error("unreachable");
          },
          async get() {
            return operation;
          },
          async submitCode() {
            throw new VerificationError(code, 409);
          },
        },
        fakeDb(),
      );
      assert.equal((await adapter.verifyProof(request)).status, expected);
    }
  });
});
