import {
  HostedAuthContactChallengeStartedSchema,
  HostedAuthContactProofResultSchema,
  HostedAuthEmailChallengeRequestSchema,
  HostedAuthEmailProofRequestSchema,
  type HostedAuthContactChallengeStarted,
  type HostedAuthContactProofResult,
  type HostedAuthEmailChallengeRequest,
  type HostedAuthEmailProofRequest,
  type HostedAuthEmailProvider,
  type HostedAuthProviderOperationId,
} from "@powerotp/contracts";
import type { Db } from "mongodb";

import {
  type EmailOtpBranding,
  type EmailOtpService,
} from "./email-otp-service.js";
import type { HostedAuthEmailProofVerification } from "./hosted-auth-email-challenge-repository.js";
import type { ProjectDocument } from "./persistence.js";
import { createFiveDigitCode } from "./security.js";

export interface HostedAuthEmailChallengeAuthority {
  issue(input: {
    authRequestId: string;
    scope: HostedAuthEmailChallengeRequest["scope"];
    code: string;
  }): Promise<HostedAuthProviderOperationId>;
  verifyAndConsume(input: {
    authRequestId: string;
    scope: HostedAuthEmailProofRequest["scope"];
    providerOperationId: string;
    proof: string;
  }): Promise<HostedAuthEmailProofVerification>;
}

export interface HostedAuthEmailBrandingResolver {
  (projectId: string): Promise<EmailOtpBranding | undefined>;
}

export class HostedAuthEmailRoutingError extends Error {
  constructor() {
    super("hosted_auth_email_custody_mismatch");
  }
}

export function createHostedAuthEmailBrandingResolver(
  db: Db,
): HostedAuthEmailBrandingResolver {
  const projects = db.collection<ProjectDocument>("projects");
  return async (projectId) => {
    const project = await projects.findOne(
      { _id: projectId },
      {
        projection: {
          brandName: 1,
          brandLogoUrl: 1,
          brandReplyToEmail: 1,
          brandHtmlTemplate: 1,
        },
      },
    );
    return project
      ? {
          brandName: project.brandName,
          brandLogoUrl: project.brandLogoUrl,
          brandReplyToEmail: project.brandReplyToEmail,
          brandHtmlTemplate: project.brandHtmlTemplate,
        }
      : undefined;
  };
}

/**
 * POWEROTP-custody hosted-auth email adapter. It deliberately accepts only
 * `powerotp_email` operations in the `powerotp_pii` realm. A Didit-custody
 * request fails before branding lookup, challenge creation, or Brevo delivery.
 */
export class HostedAuthBrevoEmailProvider implements HostedAuthEmailProvider {
  constructor(
    private readonly email: EmailOtpService,
    private readonly challenges: HostedAuthEmailChallengeAuthority,
    private readonly resolveBranding: HostedAuthEmailBrandingResolver,
  ) {}

  async startChallenge(
    input: HostedAuthEmailChallengeRequest,
  ): Promise<HostedAuthContactChallengeStarted> {
    const request = HostedAuthEmailChallengeRequestSchema.parse(input);
    this.#requirePowerOtpCustody(request);
    const code = createFiveDigitCode();
    const branding = await this.resolveBranding(request.scope.projectId);

    await this.email.sendOtpCode(
      request.destination,
      code,
      branding,
      { purpose: `hosted_auth_${request.scope.providerPurpose}` },
    );
    const providerOperationId = await this.challenges.issue({
      authRequestId: request.authRequestId,
      scope: request.scope,
      code,
    });
    return HostedAuthContactChallengeStartedSchema.parse({
      authRequestId: request.authRequestId,
      scope: request.scope,
      providerOperationId,
      status: "challenge_sent",
    });
  }

  async verifyProof(
    input: HostedAuthEmailProofRequest,
  ): Promise<HostedAuthContactProofResult> {
    const request = HostedAuthEmailProofRequestSchema.parse(input);
    this.#requirePowerOtpCustody(request);
    const result = await this.challenges.verifyAndConsume({
      authRequestId: request.authRequestId,
      scope: request.scope,
      providerOperationId: request.providerOperationId,
      proof: request.proof,
    });
    return HostedAuthContactProofResultSchema.parse({
      authRequestId: request.authRequestId,
      scope: request.scope,
      providerOperationId: request.providerOperationId,
      status: result.status,
      ...(result.status === "verified"
        ? { minimalEvidenceReference: result.minimalEvidenceReference }
        : {}),
    });
  }

  #requirePowerOtpCustody(
    request: HostedAuthEmailChallengeRequest | HostedAuthEmailProofRequest,
  ): void {
    if (
      request.provider !== "powerotp_email" ||
      request.scope.realm.identityDataMode !== "powerotp_pii"
    ) {
      throw new HostedAuthEmailRoutingError();
    }
  }
}
