import { z } from "zod";

export const DiditEnvironmentSchema = z.enum(["live", "sandbox"]);
const DiditFeatureSchema = z.enum(["OCR", "LIVENESS", "FACE_MATCH"]);
const DiditGraphNodeSchema = z
  .object({
    node_type: z.enum(["feature", "status"]),
    feature: z.string().optional(),
    next: z.string().nullable().optional(),
    session_status: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export const DiditWorkflowSchema = z
  .object({
    uuid: z.uuid(),
    workflow_id: z.uuid(),
    workflow_type: z.literal("kyc"),
    version: z.number().int().positive(),
    status: z.literal("published"),
    is_editable: z.literal(false),
    features: z.string(),
    total_price: z.number().finite().nonnegative(),
    max_price: z.number().finite().nonnegative(),
    response_attributes: z.record(z.string(), z.array(z.string())),
    workflow_graph: z.object({
      start_node: z.string().min(1),
      nodes: z.record(z.string(), DiditGraphNodeSchema),
    }),
  })
  .passthrough();

export type DiditSessionPurpose =
  | "age_assurance"
  | "identity_kyc_assurance"
  | "liveness_and_face_enrollment";

export const DIDIT_SESSION_POLICIES: Readonly<
  Record<
    DiditSessionPurpose,
    Readonly<{
      features: readonly z.infer<typeof DiditFeatureSchema>[];
      returnedData: Readonly<Record<string, readonly string[]>>;
      workflowConfig:
        | "DIDIT_AGE_WORKFLOW_ID"
        | "DIDIT_KYC_WORKFLOW_ID"
        | "DIDIT_LIVENESS_WORKFLOW_ID";
    }>
  >
> = {
  age_assurance: {
    features: ["OCR"],
    returnedData: { OCR: ["date_of_birth"] },
    workflowConfig: "DIDIT_AGE_WORKFLOW_ID",
  },
  identity_kyc_assurance: {
    features: ["OCR", "LIVENESS", "FACE_MATCH"],
    returnedData: { OCR: [], LIVENESS: [], FACE_MATCH: [] },
    workflowConfig: "DIDIT_KYC_WORKFLOW_ID",
  },
  liveness_and_face_enrollment: {
    features: ["LIVENESS"],
    returnedData: { LIVENESS: [] },
    workflowConfig: "DIDIT_LIVENESS_WORKFLOW_ID",
  },
};

export class HostedAuthDiditSessionConfigurationError extends Error {
  constructor(
    readonly code:
      | "workflow_unavailable"
      | "workflow_contract_mismatch"
      | "workflow_graph_mismatch"
      | "returned_data_policy_mismatch"
      | "provider_price_mismatch",
  ) {
    super(`hosted_auth_didit_session_${code}`);
  }
}

export function validateDiditWorkflow(
  expectedId: string,
  workflow: z.infer<typeof DiditWorkflowSchema>,
  expectedFeatures: readonly z.infer<typeof DiditFeatureSchema>[],
  expectedReturnedData: Readonly<Record<string, readonly string[]>>,
): void {
  if (
    workflow.workflow_id !== expectedId ||
    workflow.features !== expectedFeatures.join(" + ")
  ) {
    throw new HostedAuthDiditSessionConfigurationError(
      "workflow_contract_mismatch",
    );
  }
  const features = graphFeatures(workflow.workflow_graph);
  if (
    !sameJson(features, expectedFeatures) ||
    (features.includes("LIVENESS") &&
      !hasPassiveLiveness(workflow.workflow_graph))
  ) {
    throw new HostedAuthDiditSessionConfigurationError(
      "workflow_graph_mismatch",
    );
  }
  if (!sameJson(workflow.response_attributes, expectedReturnedData)) {
    throw new HostedAuthDiditSessionConfigurationError(
      "returned_data_policy_mismatch",
    );
  }
  if (workflow.total_price !== workflow.max_price) {
    throw new HostedAuthDiditSessionConfigurationError(
      "provider_price_mismatch",
    );
  }
}

function graphFeatures(
  graph: z.infer<typeof DiditWorkflowSchema>["workflow_graph"],
): string[] {
  const visited = new Set<string>();
  const features: string[] = [];
  let nodeId: string | null = graph.start_node;
  while (nodeId !== null) {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);
    const node: z.infer<typeof DiditGraphNodeSchema> | undefined =
      graph.nodes[nodeId];
    if (!node) return [];
    if (node.node_type === "status") {
      if (node.session_status !== "Determine" || node.next !== undefined) return [];
      nodeId = null;
    } else {
      const feature = DiditFeatureSchema.safeParse(node.feature);
      if (!feature.success || typeof node.next !== "string") return [];
      features.push(feature.data);
      nodeId = node.next;
    }
  }
  return visited.size === Object.keys(graph.nodes).length ? features : [];
}

function hasPassiveLiveness(
  graph: z.infer<typeof DiditWorkflowSchema>["workflow_graph"],
): boolean {
  return Object.values(graph.nodes).some(
    (node) =>
      node.node_type === "feature" &&
      node.feature === "LIVENESS" &&
      node.config?.face_liveness_method === "PASSIVE",
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}
