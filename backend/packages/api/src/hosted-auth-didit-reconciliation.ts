import {
  HostedAuthProviderOperationIdSchema,
  PotpDiditIdSchema,
} from "@powerotp/contracts";
import { z } from "zod";

import type { ProductionConfig } from "./config.js";

const DIDIT_API_ORIGIN = "https://verification.didit.me";
const DIDIT_REQUEST_TIMEOUT_MS = 10_000;
const DIDIT_POLL_BASE_DELAY_MS = 10_000;
const DIDIT_POLL_MAX_DELAY_MS = 60_000;

export const HostedAuthDiditSessionStatusSchema = z.enum([
  "Not Started",
  "In Progress",
  "Awaiting User",
  "In Review",
  "Approved",
  "Declined",
  "Resubmitted",
  "Expired",
  "Kyc Expired",
  "Abandoned",
]);

const DiditDecisionEnvelopeSchema = z
  .object({
    session_id: z.uuid(),
    session_kind: z.literal("user"),
    status: HostedAuthDiditSessionStatusSchema,
    environment: z.enum(["live", "sandbox"]),
    workflow_id: z.uuid(),
    vendor_data: PotpDiditIdSchema,
  })
  .passthrough();

const ReconciliationRequestSchema = z
  .object({
    providerOperationId: HostedAuthProviderOperationIdSchema,
    potpDiditId: PotpDiditIdSchema,
    workflowId: z.uuid(),
    environment: z.enum(["live", "sandbox"]),
    attempt: z.number().int().positive(),
  })
  .strict();

export type HostedAuthDiditReconciliationSnapshot = Readonly<{
  providerOperationId: string;
  potpDiditId: string;
  workflowId: string;
  environment: "live" | "sandbox";
  status: z.infer<typeof HostedAuthDiditSessionStatusSchema>;
  reconciledAt: Date;
}>;

export type HostedAuthDiditReconciliationDisposition = "accepted" | "unchanged";

export interface HostedAuthDiditReconciliationRepository {
  reconcile(
    snapshot: HostedAuthDiditReconciliationSnapshot,
  ): Promise<HostedAuthDiditReconciliationDisposition>;
}

export type HostedAuthDiditReconciliationResult =
  | Readonly<{
      outcome: "reconciled";
      disposition: HostedAuthDiditReconciliationDisposition;
      snapshot: HostedAuthDiditReconciliationSnapshot;
    }>
  | Readonly<{
      outcome: "retryable_failure";
      reason: "provider_unavailable" | "rate_limited" | "session_not_found";
      nextPollAfterMs: number;
    }>;

export class HostedAuthDiditReconciliationError extends Error {
  constructor(
    readonly code:
      | "provider_authentication_failed"
      | "provider_contract_mismatch"
      | "provider_binding_mismatch",
  ) {
    super(`hosted_auth_didit_reconciliation_${code}`);
  }
}

type Fetch = typeof fetch;

/**
 * Polls only for cold-start/backfill reconciliation. The full decision body is
 * validated in memory, but only its PII-free session envelope is persisted.
 */
export class HostedAuthDiditReconciliationService {
  constructor(
    private readonly apiKey: string,
    private readonly repository: HostedAuthDiditReconciliationRepository,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (apiKey.length === 0) throw new Error("Didit API key is required");
  }

  async reconcile(
    input: z.input<typeof ReconciliationRequestSchema>,
  ): Promise<HostedAuthDiditReconciliationResult> {
    const request = ReconciliationRequestSchema.parse(input);
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${DIDIT_API_ORIGIN}/v3/session/${request.providerOperationId}/decision/`,
        {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(DIDIT_REQUEST_TIMEOUT_MS),
          headers: {
            accept: "application/json",
            "x-api-key": this.apiKey,
          },
        },
      );
    } catch {
      return retryable("provider_unavailable", request.attempt);
    }

    if (response.status === 404) {
      return retryable("session_not_found", request.attempt);
    }
    if (response.status === 429) {
      return retryable("rate_limited", request.attempt);
    }
    if (response.status >= 500) {
      return retryable("provider_unavailable", request.attempt);
    }
    if (response.status === 403) {
      throw new HostedAuthDiditReconciliationError(
        "provider_authentication_failed",
      );
    }
    if (response.status !== 200) {
      throw new HostedAuthDiditReconciliationError(
        "provider_contract_mismatch",
      );
    }

    let decision: z.output<typeof DiditDecisionEnvelopeSchema>;
    try {
      decision = DiditDecisionEnvelopeSchema.parse(await response.json());
    } catch {
      throw new HostedAuthDiditReconciliationError(
        "provider_contract_mismatch",
      );
    }
    if (
      decision.session_id !== request.providerOperationId ||
      decision.vendor_data !== request.potpDiditId ||
      decision.workflow_id !== request.workflowId ||
      decision.environment !== request.environment
    ) {
      throw new HostedAuthDiditReconciliationError(
        "provider_binding_mismatch",
      );
    }

    const snapshot: HostedAuthDiditReconciliationSnapshot = {
      providerOperationId: decision.session_id,
      potpDiditId: decision.vendor_data,
      workflowId: decision.workflow_id,
      environment: decision.environment,
      status: decision.status,
      reconciledAt: this.now(),
    };
    return {
      outcome: "reconciled",
      disposition: await this.repository.reconcile(snapshot),
      snapshot,
    };
  }
}

export function createHostedAuthDiditReconciliationService(
  config: Pick<ProductionConfig, "DIDIT_API_KEY">,
  repository: HostedAuthDiditReconciliationRepository,
  fetchImpl: Fetch = fetch,
  now?: () => Date,
): HostedAuthDiditReconciliationService | undefined {
  return config.DIDIT_API_KEY
    ? new HostedAuthDiditReconciliationService(
        config.DIDIT_API_KEY,
        repository,
        fetchImpl,
        now,
      )
    : undefined;
}

function retryable(
  reason: "provider_unavailable" | "rate_limited" | "session_not_found",
  attempt: number,
): HostedAuthDiditReconciliationResult {
  return {
    outcome: "retryable_failure",
    reason,
    nextPollAfterMs: Math.min(
      DIDIT_POLL_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 10),
      DIDIT_POLL_MAX_DELAY_MS,
    ),
  };
}
