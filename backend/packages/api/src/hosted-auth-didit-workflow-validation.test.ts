import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DiditWorkflowSchema,
  HostedAuthDiditSessionConfigurationError,
  validateDiditWorkflow,
} from "./hosted-auth-didit-workflow-validation.js";

const workflowId = "11111111-1111-4111-8111-111111111111";

function workflow() {
  return {
    uuid: workflowId,
    workflow_id: workflowId,
    workflow_type: "kyc",
    version: 2,
    status: "published",
    is_editable: false,
    features: "OCR + LIVENESS + FACE_MATCH",
    total_price: 0.3,
    max_price: 0.3,
    response_attributes: {
      FACE_MATCH: [],
      OCR: [],
      LIVENESS: [],
    },
    workflow_graph: {
      start_node: "document",
      nodes: {
        document: {
          node_type: "feature",
          feature: "OCR",
          next: "liveness",
          config: { documents_allowed: { USA: {} } },
        },
        liveness: {
          node_type: "feature",
          feature: "LIVENESS",
          next: "face",
          config: { face_liveness_method: "PASSIVE" },
        },
        face: {
          node_type: "feature",
          feature: "FACE_MATCH",
          next: "final",
          config: {},
        },
        final: { node_type: "status", session_status: "Determine" },
      },
    },
  };
}

const expectedFeatures = ["OCR", "LIVENESS", "FACE_MATCH"] as const;
const expectedReturnedData = { OCR: [], LIVENESS: [], FACE_MATCH: [] };

describe("hosted-auth Didit workflow validation", () => {
  it("accepts one published linear passive-KYC graph and exact minimal return policy", () => {
    assert.doesNotThrow(() =>
      validateDiditWorkflow(
        workflowId,
        DiditWorkflowSchema.parse(workflow()),
        expectedFeatures,
        expectedReturnedData,
      ),
    );
  });

  it("rejects graph additions, branches, wrong order, and non-passive liveness", () => {
    const mutations = [
      (value: ReturnType<typeof workflow>) => {
        value.workflow_graph.nodes.ip = {
          node_type: "feature",
          feature: "IP_ANALYSIS",
          next: "final",
          config: {},
        };
      },
      (value: ReturnType<typeof workflow>) => {
        value.workflow_graph.nodes.document.next = "face";
      },
      (value: ReturnType<typeof workflow>) => {
        value.workflow_graph.nodes.liveness.config = {
          face_liveness_method: "ACTIVE_3D",
        };
      },
      (value: ReturnType<typeof workflow>) => {
        value.workflow_graph.nodes.final = {
          node_type: "status",
          session_status: "Approved",
        };
      },
    ];

    for (const mutate of mutations) {
      const value = workflow();
      mutate(value);
      assert.throws(
        () =>
          validateDiditWorkflow(
            workflowId,
            DiditWorkflowSchema.parse(value),
            expectedFeatures,
            expectedReturnedData,
          ),
        (error: unknown) =>
          error instanceof HostedAuthDiditSessionConfigurationError &&
          error.code === "workflow_graph_mismatch",
      );
    }
  });

  it("rejects all-data and over-broad returned-data policies", () => {
    const allData = { ...workflow(), response_attributes: null };
    assert.equal(DiditWorkflowSchema.safeParse(allData).success, false);

    const extraField = workflow();
    extraField.response_attributes.OCR = ["date_of_birth"];
    assert.throws(
      () =>
        validateDiditWorkflow(
          workflowId,
          DiditWorkflowSchema.parse(extraField),
          expectedFeatures,
          expectedReturnedData,
        ),
      (error: unknown) =>
        error instanceof HostedAuthDiditSessionConfigurationError &&
        error.code === "returned_data_policy_mismatch",
    );
  });

  it("rejects workflow drift and inconsistent provider-computed prices", () => {
    const wrongPurpose = workflow();
    wrongPurpose.features = "OCR";
    assert.throws(
      () =>
        validateDiditWorkflow(
          workflowId,
          DiditWorkflowSchema.parse(wrongPurpose),
          expectedFeatures,
          expectedReturnedData,
        ),
      (error: unknown) =>
        error instanceof HostedAuthDiditSessionConfigurationError &&
        error.code === "workflow_contract_mismatch",
    );

    const inconsistentPrice = workflow();
    inconsistentPrice.max_price = 0.31;
    assert.throws(
      () =>
        validateDiditWorkflow(
          workflowId,
          DiditWorkflowSchema.parse(inconsistentPrice),
          expectedFeatures,
          expectedReturnedData,
        ),
      (error: unknown) =>
        error instanceof HostedAuthDiditSessionConfigurationError &&
        error.code === "provider_price_mismatch",
    );
  });
});
