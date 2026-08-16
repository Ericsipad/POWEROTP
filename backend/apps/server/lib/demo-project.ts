import { ApiError } from "@powerotp/api/errors.js";
import type { ProjectDocument } from "@powerotp/api/persistence.js";

import type { ServerContext } from "./server-context";

/**
 * Shared by every `/v1/demo/*` route (create, status, response) — the
 * public "try it now" demo widget is scoped to one operator-configured
 * project (`DEMO_PROJECT_SLUG`), never a customer's own project.
 */
export async function requireDemoProject(context: ServerContext): Promise<ProjectDocument> {
  if (!context.config.DEMO_PROJECT_SLUG) throw new ApiError("demo_not_configured", 404);
  const project = await context.dataStores.db
    .collection<ProjectDocument>("projects")
    .findOne({ slug: context.config.DEMO_PROJECT_SLUG, active: true });
  if (!project) throw new ApiError("demo_not_configured", 404);
  return project;
}
