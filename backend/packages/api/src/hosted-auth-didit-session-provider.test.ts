import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedAuthRequestIdSchema,
  HostedAuthVerificationScopeSchema,
  hostedAuthRealms,
  type HostedAuthVerificationPurpose,
} from "@powerotp/contracts";

import {
  HostedAuthDiditSessionBindingError,
  createHostedAuthDiditSessionProviders,
  type HostedAuthDiditSessionMappingResolver,
} from "./hosted-auth-didit-session-provider.js";

const authRequestId = HostedAuthRequestIdSchema.parse(`har_${"A".repeat(43)}`);
const mapping = {
  potpDiditId: `pdi_${"A".repeat(43)}`,
  diditInternalId: "123e4567-e89b-42d3-a456-426614174000",
};
const workflowIds = {
  DIDIT_AGE_WORKFLOW_ID: "11111111-1111-4111-8111-111111111111",
  DIDIT_KYC_WORKFLOW_ID: "22222222-2222-4222-8222-222222222222",
  DIDIT_LIVENESS_WORKFLOW_ID: "33333333-3333-4333-8333-333333333333",
};
const config = {
  DIDIT_API_KEY: "server-api-key",
  DIDIT_ENVIRONMENT: "sandbox" as const,
  ...workflowIds,
};
const sessionId = "44444444-4444-4444-8444-444444444444";

function scope(
  providerPurpose: HostedAuthVerificationPurpose,
  mode: "powerotp_pii" | "didit_pii" = "powerotp_pii",
) {
  return HostedAuthVerificationScopeSchema.parse({
    projectId: "project_scope_0001",
    realm: hostedAuthRealms[mode],
    flow: providerPurpose === "recovery_proof" ? "signin" : "signup",
    providerPurpose,
  });
}

function resolver(
  value = mapping,
): HostedAuthDiditSessionMappingResolver {
  return { async resolve() { return value; } };
}

function workflow(
  id: string,
  features: string[],
  returnedData: Record<string, string[]>,
  totalPrice: number,
) {
  const nodes: Record<string, unknown> = {};
  features.forEach((feature, index) => {
    nodes[`feature_${index}`] = {
      node_type: "feature",
      feature,
      next: index === features.length - 1 ? "final" : `feature_${index + 1}`,
      config:
        feature === "LIVENESS" ? { face_liveness_method: "PASSIVE" } : {},
    };
  });
  nodes.final = { node_type: "status", session_status: "Determine" };
  return {
    uuid: id,
    workflow_id: id,
    workflow_type: "kyc",
    version: 3,
    status: "published",
    is_editable: false,
    features: features.join(" + "),
    total_price: totalPrice,
    max_price: totalPrice,
    response_attributes: returnedData,
    workflow_graph: { start_node: "feature_0", nodes },
  };
}

function workflowResponse(id: string): Response {
  if (id === workflowIds.DIDIT_AGE_WORKFLOW_ID) {
    return Response.json(workflow(id, ["OCR"], { OCR: ["date_of_birth"] }, 0.17));
  }
  if (id === workflowIds.DIDIT_KYC_WORKFLOW_ID) {
    return Response.json(
      workflow(
        id,
        ["OCR", "LIVENESS", "FACE_MATCH"],
        { OCR: [], LIVENESS: [], FACE_MATCH: [] },
        0.42,
      ),
    );
  }
  return Response.json(workflow(id, ["LIVENESS"], { LIVENESS: [] }, 0.09));
}

describe("hosted-auth Didit session providers", () => {
  it("validates all purpose workflows atomically and uses provider-computed prices", async () => {
    const requested: string[] = [];
    const providers = await createHostedAuthDiditSessionProviders(
      config,
      resolver(),
      async (url) => {
        const id = String(url).split("/").at(-2)!;
        requested.push(id);
        return workflowResponse(id);
      },
    );

    assert.deepEqual(requested.sort(), Object.values(workflowIds).sort());
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(providers!.workflows).map(([purpose, value]) => [
          purpose,
          value.providerPriceUsd,
        ]),
      ),
      {
        age_assurance: "0.17",
        identity_kyc_assurance: "0.42",
        liveness_and_face_enrollment: "0.09",
      },
    );
    assert.equal(providers!.workflows.age_assurance.environment, "sandbox");
  });

  it("creates a minimal purpose-bound session for either custody realm", async () => {
    let sessionBody: Record<string, unknown> | undefined;
    const providers = await createHostedAuthDiditSessionProviders(
      config,
      resolver(),
      async (url, init) => {
        if (String(url).endsWith("/v3/session/")) {
          sessionBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json(
            {
              session_id: sessionId,
              session_token: "must-not-escape",
              url: "https://verify.didit.me/session/must-not-escape",
              status: "Not Started",
              workflow_id: workflowIds.DIDIT_KYC_WORKFLOW_ID,
              workflow_version: 3,
              vendor_data: mapping.potpDiditId,
              metadata: {
                authRequestId,
                providerPurpose: "identity_kyc_assurance",
                expectedEnvironment: "sandbox",
              },
              id_verifications: [{ full_name: "must-not-escape" }],
            },
            { status: 201 },
          );
        }
        return workflowResponse(String(url).split("/").at(-2)!);
      },
    );
    const result = await providers!.kyc.startVerification({
      authRequestId,
      scope: scope("identity_kyc_assurance", "didit_pii"),
      ...mapping,
    });

    assert.deepEqual(sessionBody, {
      workflow_id: workflowIds.DIDIT_KYC_WORKFLOW_ID,
      vendor_data: mapping.potpDiditId,
      metadata: {
        authRequestId,
        providerPurpose: "identity_kyc_assurance",
        expectedEnvironment: "sandbox",
      },
    });
    assert.deepEqual(result, {
      authRequestId,
      scope: scope("identity_kyc_assurance", "didit_pii"),
      providerOperationId: sessionId,
      status: "provider_operation_pending",
      sessionUrl: "https://verify.didit.me/session/must-not-escape",
    });
    assert.equal("session_token" in result, false);
    assert.equal("id_verifications" in result, false);
  });

  it("rejects wrong-purpose and non-existent person mappings before session creation", async () => {
    let sessionCreates = 0;
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/v3/session/")) sessionCreates += 1;
      return workflowResponse(String(url).split("/").at(-2)!);
    };
    const providers = await createHostedAuthDiditSessionProviders(
      config,
      resolver({ ...mapping, potpDiditId: `pdi_C${"A".repeat(42)}` }),
      fetchImpl,
    );
    const request = {
      authRequestId,
      scope: scope("age_assurance"),
      ...mapping,
    };

    await assert.rejects(
      providers!.kyc.startVerification(request),
      HostedAuthDiditSessionBindingError,
    );
    await assert.rejects(
      providers!.age.startVerification(request),
      HostedAuthDiditSessionBindingError,
    );
    assert.equal(sessionCreates, 0);
  });

  it("stays disabled when Didit is unconfigured", async () => {
    assert.equal(
      await createHostedAuthDiditSessionProviders({}, resolver()),
      undefined,
    );
  });
});
