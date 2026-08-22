import {
  HostedAuthContactChallengeStartedSchema,
  HostedAuthContactProofResultSchema,
  HostedAuthDiditUserResultSchema,
  HostedAuthEmailChallengeRequestSchema,
  HostedAuthEmailProofRequestSchema,
  HostedAuthPhoneChallengeRequestSchema,
  HostedAuthPhoneProofRequestSchema,
  HostedAuthProviderEvidenceReferenceSchema,
  HostedAuthProviderOperationIdSchema,
  type HostedAuthContactChallengeStarted,
  type HostedAuthContactProofResult,
  type HostedAuthContactScope,
  type HostedAuthDiditUserResult,
  type HostedAuthEmailChallengeRequest,
  type HostedAuthEmailProofRequest,
  type HostedAuthEmailProvider,
  type HostedAuthPhoneChallengeRequest,
  type HostedAuthPhoneProofRequest,
  type HostedAuthPhoneProvider,
} from "@powerotp/contracts";
import { z } from "zod";

import type { ProductionConfig } from "./config.js";

const DIDIT_API_ORIGIN = "https://verification.didit.me";
const DIDIT_REQUEST_TIMEOUT_MS = 10_000;
const DiditSendResponseSchema = z
  .object({
    request_id: z.uuid(),
    status: z.enum(["Success", "Retry", "Undeliverable", "Blocked"]),
    vendor_data: z.string().nullable(),
  })
  .passthrough();
const DiditCheckResponseSchema = z
  .object({
    request_id: z.uuid(),
    status: z.enum(["Approved", "Declined", "Failed", "Expired or Not Found"]),
    vendor_data: z.string().nullable(),
  })
  .passthrough();

type ContactChannel = "email" | "phone";
type Fetch = typeof fetch;

export interface HostedAuthDiditContactMappingResolver {
  resolve(
    authRequestId: string,
    scope: HostedAuthContactScope,
  ): Promise<HostedAuthDiditUserResult>;
}

export class HostedAuthDiditContactRoutingError extends Error {
  constructor() {
    super("hosted_auth_didit_contact_custody_mismatch");
  }
}

export class HostedAuthDiditContactRejectedError extends Error {
  constructor(channel: ContactChannel) {
    super(`hosted_auth_didit_${channel}_challenge_rejected`);
  }
}

class DiditContactApi {
  constructor(
    private readonly apiKey: string,
    private readonly mappings: HostedAuthDiditContactMappingResolver,
    private readonly fetchImpl: Fetch,
  ) {
    if (apiKey.length === 0) throw new Error("Didit API key is required");
  }

  async start(
    channel: ContactChannel,
    request: HostedAuthEmailChallengeRequest | HostedAuthPhoneChallengeRequest,
  ): Promise<HostedAuthContactChallengeStarted> {
    requireDiditRoute(channel, request);
    const mapping = HostedAuthDiditUserResultSchema.parse(
      await this.mappings.resolve(request.authRequestId, request.scope),
    );
    const response = await this.request(`/v3/${channel}/send/`, {
      method: "POST",
      body: JSON.stringify(
        channel === "email"
          ? {
              email: request.destination,
              options: {
                code_size: 6,
                locale: "en",
                use_white_label_customization: true,
              },
              vendor_data: mapping.potpDiditId,
            }
          : {
              phone_number: request.destination,
              options: {
                code_size: 6,
                locale: "en",
                preferred_channel: "sms",
              },
              vendor_data: mapping.potpDiditId,
            },
      ),
    });
    if (response.status !== 200) {
      throw new Error(
        `Didit ${channel} challenge failed with HTTP ${response.status}`,
      );
    }
    const result = DiditSendResponseSchema.parse(await response.json());
    if (result.vendor_data !== mapping.potpDiditId) {
      throw new Error("Didit contact challenge returned different vendor data");
    }
    if (result.status !== "Success" && result.status !== "Retry") {
      throw new HostedAuthDiditContactRejectedError(channel);
    }
    return HostedAuthContactChallengeStartedSchema.parse({
      authRequestId: request.authRequestId,
      scope: request.scope,
      providerOperationId: result.request_id,
      status: "challenge_sent",
    });
  }

  async verify(
    channel: ContactChannel,
    request: HostedAuthEmailProofRequest | HostedAuthPhoneProofRequest,
  ): Promise<HostedAuthContactProofResult> {
    requireDiditRoute(channel, request);
    if (!/^\d{6}$/.test(request.proof)) return proofResult(request, "rejected");

    const mapping = HostedAuthDiditUserResultSchema.parse(
      await this.mappings.resolve(request.authRequestId, request.scope),
    );
    let response: Response;
    try {
      response = await this.request(`/v3/${channel}/check/`, {
        method: "POST",
        body: JSON.stringify(
          channel === "email"
            ? { email: request.destination, code: request.proof }
            : { phone_number: request.destination, code: request.proof },
        ),
      });
    } catch {
      return proofResult(request, "retryable_failure");
    }
    if (response.status === 400) return proofResult(request, "rejected");
    if (response.status === 429 || response.status >= 500) {
      return proofResult(request, "retryable_failure");
    }
    if (response.status !== 200) {
      throw new Error(`Didit ${channel} proof failed with HTTP ${response.status}`);
    }

    const result = DiditCheckResponseSchema.parse(await response.json());
    if (result.status === "Expired or Not Found" && result.vendor_data === null) {
      return proofResult(request, "rejected");
    }
    if (result.vendor_data !== mapping.potpDiditId) {
      throw new Error("Didit contact proof returned different vendor data");
    }
    if (
      (result.status === "Approved" || result.status === "Declined") &&
      result.request_id !== request.providerOperationId
    ) {
      throw new Error("Didit contact proof returned a different operation");
    }
    if (result.status === "Approved") {
      return proofResult(
        request,
        "verified",
        HostedAuthProviderEvidenceReferenceSchema.parse(result.request_id),
      );
    }
    if (result.status === "Declined") return proofResult(request, "declined");
    return proofResult(request, "rejected");
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(`${DIDIT_API_ORIGIN}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(DIDIT_REQUEST_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
    });
  }
}

export class HostedAuthDiditEmailProvider implements HostedAuthEmailProvider {
  constructor(private readonly api: DiditContactApi) {}

  startChallenge(input: HostedAuthEmailChallengeRequest) {
    return this.api.start("email", HostedAuthEmailChallengeRequestSchema.parse(input));
  }

  verifyProof(input: HostedAuthEmailProofRequest) {
    return this.api.verify("email", HostedAuthEmailProofRequestSchema.parse(input));
  }
}

export class HostedAuthDiditPhoneProvider implements HostedAuthPhoneProvider {
  constructor(private readonly api: DiditContactApi) {}

  startChallenge(input: HostedAuthPhoneChallengeRequest) {
    return this.api.start("phone", HostedAuthPhoneChallengeRequestSchema.parse(input));
  }

  verifyProof(input: HostedAuthPhoneProofRequest) {
    return this.api.verify("phone", HostedAuthPhoneProofRequestSchema.parse(input));
  }
}

export function createHostedAuthDiditContactProviders(
  config: Pick<ProductionConfig, "DIDIT_API_KEY">,
  mappings: HostedAuthDiditContactMappingResolver,
  fetchImpl: Fetch = fetch,
): Readonly<{
  email: HostedAuthEmailProvider;
  phone: HostedAuthPhoneProvider;
}> | undefined {
  if (!config.DIDIT_API_KEY) return undefined;
  const api = new DiditContactApi(config.DIDIT_API_KEY, mappings, fetchImpl);
  return {
    email: new HostedAuthDiditEmailProvider(api),
    phone: new HostedAuthDiditPhoneProvider(api),
  };
}

function requireDiditRoute(
  channel: ContactChannel,
  request:
    | HostedAuthEmailChallengeRequest
    | HostedAuthPhoneChallengeRequest
    | HostedAuthEmailProofRequest
    | HostedAuthPhoneProofRequest,
): void {
  if (
    request.scope.realm.identityDataMode !== "didit_pii" ||
    request.provider !== `didit_${channel}`
  ) {
    throw new HostedAuthDiditContactRoutingError();
  }
}

function proofResult(
  request: HostedAuthEmailProofRequest | HostedAuthPhoneProofRequest,
  status: "verified" | "rejected" | "declined" | "retryable_failure",
  minimalEvidenceReference?: string,
): HostedAuthContactProofResult {
  return HostedAuthContactProofResultSchema.parse({
    authRequestId: request.authRequestId,
    scope: request.scope,
    providerOperationId: HostedAuthProviderOperationIdSchema.parse(
      request.providerOperationId,
    ),
    status,
    ...(minimalEvidenceReference ? { minimalEvidenceReference } : {}),
  });
}
