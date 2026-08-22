import type { Db } from "mongodb";

import type { ProductionConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { isIpAllowed } from "./ip-cidr.js";
import type { ApiKeyDocument, ProjectDocument } from "./persistence.js";
import { hashToken } from "./security.js";

/**
 * Authenticates a customer-server request using its project secret API
 * key. The key is only ever accepted from the `Authorization: Bearer`
 * header, never a URL or query parameter, per the threat model.
 */
export async function authenticateApiKey(
  db: Db,
  config: Pick<ProductionConfig, "API_KEY_HASH_SECRET">,
  authorizationHeader: string | undefined,
  sourceIp: string | undefined,
): Promise<ProjectDocument> {
  const project = await authenticateApiKeyCredential(
    db,
    config,
    authorizationHeader,
  );
  enforceSourceIp(project, sourceIp);
  return project;
}

async function authenticateApiKeyCredential(
  db: Db,
  config: Pick<ProductionConfig, "API_KEY_HASH_SECRET">,
  authorizationHeader: string | undefined,
): Promise<ProjectDocument> {
  const match = /^Bearer\s+(\S+)$/.exec(authorizationHeader ?? "");
  if (!match) throw new ApiError("authentication_required", 401);

  const keyHash = hashToken(match[1]!, config.API_KEY_HASH_SECRET);
  const apiKey = await db
    .collection<ApiKeyDocument>("apiKeys")
    .findOne({ keyHash, revokedAt: { $exists: false } });
  if (!apiKey) throw new ApiError("authentication_required", 401);

  const project = await db
    .collection<ProjectDocument>("projects")
    .findOne({ _id: apiKey.projectId });
  if (!project?.active) throw new ApiError("authentication_required", 401);
  return project;
}

export async function authenticateProjectApiKey(
  db: Db,
  config: Pick<ProductionConfig, "API_KEY_HASH_SECRET">,
  projectSlug: string,
  authorizationHeader: string | undefined,
  sourceIp: string | undefined,
): Promise<ProjectDocument> {
  const project = await authenticateApiKeyCredential(
    db,
    config,
    authorizationHeader,
  );
  if (project.slug !== projectSlug) throw new ApiError("authentication_required", 401);
  enforceSourceIp(project, sourceIp);
  return project;
}

function enforceSourceIp(project: ProjectDocument, sourceIp: string | undefined): void {
  const allowlist = project.authSettings?.backendIpAllowlist ?? [];
  if (!isIpAllowed(sourceIp, allowlist)) {
    throw new ApiError("source_ip_not_allowed", 403);
  }
}
