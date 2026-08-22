import {
  HostedAuthContactChallengeStartedSchema,
  HostedAuthContactProofResultSchema,
  HostedAuthPhoneChallengeRequestSchema,
  HostedAuthPhoneProofRequestSchema,
  HostedAuthProviderEvidenceReferenceSchema,
  HostedAuthProviderOperationIdSchema,
  type HostedAuthContactProofResult,
  type HostedAuthPhoneChallengeRequest,
  type HostedAuthPhoneProofRequest,
  type HostedAuthPhoneProvider,
} from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { ProjectDocument } from "./persistence.js";
import { VerificationError, type VerificationService } from "./verification-service.js";

type PowerOtpPhoneProvider = "powerotp_sms" | "powerotp_voice";

interface HostedAuthPhoneVerificationService {
  create: VerificationService["create"];
  get: VerificationService["get"];
  submitCode: VerificationService["submitCode"];
}

export class HostedAuthPhoneRoutingError extends Error {
  constructor() {
    super("hosted_auth_phone_custody_mismatch");
  }
}

export function createHostedAuthPowerOtpPhoneProvider(
  provider: PowerOtpPhoneProvider,
  verifications: HostedAuthPhoneVerificationService,
  db: Db,
): HostedAuthPhoneProvider {
  const projects = db.collection<ProjectDocument>("projects");

  return {
    async startChallenge(input: HostedAuthPhoneChallengeRequest) {
      const request = HostedAuthPhoneChallengeRequestSchema.parse(input);
      requireRoute(request, provider);

      const project = await projects.findOne(
        {
          _id: request.scope.projectId,
          identityDataMode: "powerotp_pii",
        },
        { projection: { customerId: 1 } },
      );
      if (!project) throw new HostedAuthPhoneRoutingError();

      const accepted = await verifications.create(
        request.scope.projectId,
        project.customerId,
        {
          type: provider === "powerotp_sms" ? "sms_code" : "voice_code",
          targetNumber: request.destination,
          browserResponse: false,
        },
        [
          "hosted-auth-phone",
          request.authRequestId,
          provider,
          request.scope.providerPurpose,
        ].join(":"),
        request.authRequestId,
        {
          authRequestId: request.authRequestId,
          scope: request.scope,
          provider,
        },
      );
      const providerOperationId = HostedAuthProviderOperationIdSchema.parse(
        accepted.interactionId,
      );
      return HostedAuthContactChallengeStartedSchema.parse({
        authRequestId: request.authRequestId,
        scope: request.scope,
        providerOperationId,
        status: "challenge_sent",
      });
    },

    async verifyProof(
      input: HostedAuthPhoneProofRequest,
    ): Promise<HostedAuthContactProofResult> {
      const request = HostedAuthPhoneProofRequestSchema.parse(input);
      requireRoute(request, provider);
      const operation = await verifications.get(request.providerOperationId);
      if (
        !operation?.hostedAuthContact ||
        operation.targetNumber !== request.destination ||
        operation.hostedAuthContact.authRequestId !== request.authRequestId ||
        operation.hostedAuthContact.provider !== provider ||
        !sameScope(operation.hostedAuthContact.scope, request.scope)
      ) {
        return proofResult(request, "rejected");
      }

      try {
        const result = await verifications.submitCode(
          request.providerOperationId,
          request.proof,
        );
        return result.succeeded
          ? proofResult(
              request,
              "verified",
              HostedAuthProviderEvidenceReferenceSchema.parse(
                request.providerOperationId,
              ),
            )
          : proofResult(request, "rejected");
      } catch (error) {
        if (
          error instanceof VerificationError &&
          (error.code === "not_awaiting_response" ||
            error.code === "stale_verification_state")
        ) {
          return proofResult(request, "retryable_failure");
        }
        if (
          error instanceof VerificationError &&
          (error.code === "verification_not_found" ||
            error.code === "verification_already_resolved")
        ) {
          return proofResult(request, "rejected");
        }
        throw error;
      }
    },
  };
}

function requireRoute(
  request: HostedAuthPhoneChallengeRequest | HostedAuthPhoneProofRequest,
  provider: PowerOtpPhoneProvider,
): void {
  if (
    request.provider !== provider ||
    request.scope.realm.identityDataMode !== "powerotp_pii"
  ) {
    throw new HostedAuthPhoneRoutingError();
  }
}

function sameScope(
  left: HostedAuthPhoneChallengeRequest["scope"],
  right: HostedAuthPhoneChallengeRequest["scope"],
): boolean {
  return (
    left.projectId === right.projectId &&
    left.realm.identityDataMode === right.realm.identityDataMode &&
    left.realm.origin === right.realm.origin &&
    left.realm.rpId === right.realm.rpId &&
    left.flow === right.flow &&
    left.providerPurpose === right.providerPurpose
  );
}

function proofResult(
  request: HostedAuthPhoneProofRequest,
  status: "verified" | "rejected" | "retryable_failure",
  minimalEvidenceReference?: string,
): HostedAuthContactProofResult {
  return HostedAuthContactProofResultSchema.parse({
    authRequestId: request.authRequestId,
    scope: request.scope,
    providerOperationId: request.providerOperationId,
    status,
    ...(minimalEvidenceReference ? { minimalEvidenceReference } : {}),
  });
}
