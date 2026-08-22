import {
  HostedAuthDiditUserResultSchema,
  HostedAuthDiditVerificationRequestSchema,
  HostedAuthDiditVerificationStartedSchema,
  PotpDiditIdSchema,
  type HostedAuthDiditProvider,
  type HostedAuthDiditVerificationRequest,
  type HostedAuthDiditVerificationStarted,
  type HostedAuthVerificationScope,
} from "@powerotp/contracts";
import { z } from "zod";

import type { ProductionConfig } from "./config.js";
import {
  DIDIT_SESSION_POLICIES,
  DiditEnvironmentSchema,
  DiditWorkflowSchema,
  HostedAuthDiditSessionConfigurationError,
  validateDiditWorkflow,
  type DiditSessionPurpose,
} from "./hosted-auth-didit-workflow-validation.js";

export { HostedAuthDiditSessionConfigurationError };

const DIDIT_API_ORIGIN = "https://verification.didit.me";
const DIDIT_REQUEST_TIMEOUT_MS = 10_000;

const DiditSessionSchema = z
  .object({
    session_id: z.uuid(),
    session_token: z.string().min(1),
    url: z.url(),
    status: z.enum([
      "Not Started",
      "In Progress",
      "Awaiting User",
      "Resubmitted",
    ]),
    workflow_id: z.uuid(),
    workflow_version: z.number().int().positive(),
    vendor_data: PotpDiditIdSchema,
    metadata: z.object({
      authRequestId: z.string(),
      providerPurpose: z.string(),
      expectedEnvironment: DiditEnvironmentSchema,
    }),
  })
  .passthrough();

type Fetch = typeof fetch;

export type HostedAuthDiditSessionStarted =
  HostedAuthDiditVerificationStarted &
    Readonly<{ sessionUrl: string }>;

interface DiditSessionProvider
  extends Pick<HostedAuthDiditProvider, "startVerification"> {
  startVerification(
    request: HostedAuthDiditVerificationRequest,
  ): Promise<HostedAuthDiditSessionStarted>;
}

export interface HostedAuthDiditSessionMappingResolver {
  resolve(
    authRequestId: string,
    scope: HostedAuthVerificationScope,
  ): Promise<z.infer<typeof HostedAuthDiditUserResultSchema>>;
}

export type HostedAuthDiditValidatedWorkflow = Readonly<{
  purpose: DiditSessionPurpose;
  workflowId: string;
  workflowVersion: number;
  environment: z.infer<typeof DiditEnvironmentSchema>;
  providerPriceUsd: string;
}>;

export type HostedAuthDiditSessionProviders = Readonly<{
  age: DiditSessionProvider;
  kyc: DiditSessionProvider;
  liveness: DiditSessionProvider;
  workflows: Readonly<
    Record<DiditSessionPurpose, HostedAuthDiditValidatedWorkflow>
  >;
}>;

export class HostedAuthDiditSessionBindingError extends Error {
  constructor() {
    super("hosted_auth_didit_session_person_binding_mismatch");
  }
}

class PurposeDiditSessionProvider implements DiditSessionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly purpose: DiditSessionPurpose,
    private readonly workflow: HostedAuthDiditValidatedWorkflow,
    private readonly mappings: HostedAuthDiditSessionMappingResolver,
    private readonly fetchImpl: Fetch,
  ) {}

  async startVerification(
    unparsedRequest: HostedAuthDiditVerificationRequest,
  ): Promise<HostedAuthDiditSessionStarted> {
    const request = HostedAuthDiditVerificationRequestSchema.parse(unparsedRequest);
    if (request.scope.providerPurpose !== this.purpose) {
      throw new HostedAuthDiditSessionBindingError();
    }
    const mapping = HostedAuthDiditUserResultSchema.parse(
      await this.mappings.resolve(request.authRequestId, request.scope),
    );
    if (
      mapping.potpDiditId !== request.potpDiditId ||
      mapping.diditInternalId !== request.diditInternalId
    ) {
      throw new HostedAuthDiditSessionBindingError();
    }

    const metadata = {
      authRequestId: request.authRequestId,
      providerPurpose: this.purpose,
      expectedEnvironment: this.workflow.environment,
    };
    const response = await diditRequest(
      this.fetchImpl,
      this.apiKey,
      "/v3/session/",
      {
        method: "POST",
        body: JSON.stringify({
          workflow_id: this.workflow.workflowId,
          vendor_data: mapping.potpDiditId,
          metadata,
        }),
      },
    );
    if (response.status !== 201) {
      throw new HostedAuthDiditSessionConfigurationError("workflow_unavailable");
    }

    let session: z.infer<typeof DiditSessionSchema>;
    try {
      session = DiditSessionSchema.parse(await response.json());
    } catch {
      throw new HostedAuthDiditSessionConfigurationError(
        "workflow_contract_mismatch",
      );
    }
    if (
      session.workflow_id !== this.workflow.workflowId ||
      session.workflow_version !== this.workflow.workflowVersion ||
      session.vendor_data !== mapping.potpDiditId ||
      session.metadata.authRequestId !== metadata.authRequestId ||
      session.metadata.providerPurpose !== metadata.providerPurpose ||
      session.metadata.expectedEnvironment !== metadata.expectedEnvironment
    ) {
      throw new HostedAuthDiditSessionBindingError();
    }

    const started = HostedAuthDiditVerificationStartedSchema.parse({
      authRequestId: request.authRequestId,
      scope: request.scope,
      providerOperationId: session.session_id,
      status: "provider_operation_pending",
    });
    return { ...started, sessionUrl: session.url };
  }
}

export async function createHostedAuthDiditSessionProviders(
  config: Pick<
    ProductionConfig,
    | "DIDIT_API_KEY"
    | "DIDIT_ENVIRONMENT"
    | "DIDIT_AGE_WORKFLOW_ID"
    | "DIDIT_KYC_WORKFLOW_ID"
    | "DIDIT_LIVENESS_WORKFLOW_ID"
  >,
  mappings: HostedAuthDiditSessionMappingResolver,
  fetchImpl: Fetch = fetch,
): Promise<HostedAuthDiditSessionProviders | undefined> {
  if (!config.DIDIT_API_KEY) return undefined;
  if (
    !config.DIDIT_ENVIRONMENT ||
    !config.DIDIT_AGE_WORKFLOW_ID ||
    !config.DIDIT_KYC_WORKFLOW_ID ||
    !config.DIDIT_LIVENESS_WORKFLOW_ID
  ) {
    throw new HostedAuthDiditSessionConfigurationError(
      "workflow_contract_mismatch",
    );
  }

  const entries = await Promise.all(
    (Object.entries(DIDIT_SESSION_POLICIES) as Array<
      [
        DiditSessionPurpose,
        (typeof DIDIT_SESSION_POLICIES)[DiditSessionPurpose],
      ]
    >).map(async ([purpose, policy]) => {
      const workflowId = config[policy.workflowConfig]!;
      const response = await diditRequest(
        fetchImpl,
        config.DIDIT_API_KEY!,
        `/v3/workflows/${encodeURIComponent(workflowId)}/`,
        { method: "GET" },
      );
      if (response.status !== 200) {
        throw new HostedAuthDiditSessionConfigurationError(
          "workflow_unavailable",
        );
      }
      let workflow: z.infer<typeof DiditWorkflowSchema>;
      try {
        workflow = DiditWorkflowSchema.parse(await response.json());
      } catch {
        throw new HostedAuthDiditSessionConfigurationError(
          "workflow_contract_mismatch",
        );
      }
      validateDiditWorkflow(
        workflowId,
        workflow,
        policy.features,
        policy.returnedData,
      );
      return [
        purpose,
        {
          purpose,
          workflowId,
          workflowVersion: workflow.version,
          environment: config.DIDIT_ENVIRONMENT!,
          providerPriceUsd: String(workflow.total_price),
        },
      ] as const;
    }),
  );
  const workflows = Object.fromEntries(entries) as Record<
    DiditSessionPurpose,
    HostedAuthDiditValidatedWorkflow
  >;
  return {
    age: new PurposeDiditSessionProvider(
      config.DIDIT_API_KEY,
      "age_assurance",
      workflows.age_assurance,
      mappings,
      fetchImpl,
    ),
    kyc: new PurposeDiditSessionProvider(
      config.DIDIT_API_KEY,
      "identity_kyc_assurance",
      workflows.identity_kyc_assurance,
      mappings,
      fetchImpl,
    ),
    liveness: new PurposeDiditSessionProvider(
      config.DIDIT_API_KEY,
      "liveness_and_face_enrollment",
      workflows.liveness_and_face_enrollment,
      mappings,
      fetchImpl,
    ),
    workflows,
  };
}

function diditRequest(
  fetchImpl: Fetch,
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return fetchImpl(`${DIDIT_API_ORIGIN}${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(DIDIT_REQUEST_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
  });
}
