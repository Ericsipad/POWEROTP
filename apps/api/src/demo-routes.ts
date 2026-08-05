import { DemoVerificationRequestSchema, type VerificationAccepted } from "@powerotp/contracts";
import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { z } from "zod";

import type { ProductionConfig } from "./config.js";
import { ApiError, parseBody } from "./errors.js";
import type { ProjectDocument } from "./persistence.js";
import { createSecret } from "./security.js";
import type { VerificationService } from "./verification-service.js";

const InteractionParamsSchema = z.object({ interactionId: z.string().min(16).max(80) });

/**
 * Public, anonymous "try it now" widget on the marketing site. It is
 * intentionally scoped to exactly one operator-configured demo project
 * (never an arbitrary customer project) and never accepts or returns a
 * project API key. It is disabled entirely when `DEMO_PROJECT_SLUG` is
 * unset, so no anonymous verification path exists by default.
 */
export function registerDemoRoutes(
  app: FastifyInstance,
  db: Db,
  config: Pick<ProductionConfig, "DEMO_PROJECT_SLUG" | "PUBLIC_APP_URL">,
  verifications: VerificationService,
) {
  async function demoProject(): Promise<ProjectDocument> {
    if (!config.DEMO_PROJECT_SLUG) throw new ApiError("demo_not_configured", 404);
    const project = await db
      .collection<ProjectDocument>("projects")
      .findOne({ slug: config.DEMO_PROJECT_SLUG, active: true });
    if (!project) throw new ApiError("demo_not_configured", 404);
    return project;
  }

  app.post(
    "/v1/demo/verifications",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const project = await demoProject();
      const input = parseBody(DemoVerificationRequestSchema, request.body);

      const accepted = await verifications.create(
        project._id,
        project.customerId,
        { ...input, browserResponse: false },
        createSecret(16),
        request.id,
      );

      reply.header("cache-control", "no-store");
      const response: VerificationAccepted = {
        interactionId: accepted.interactionId,
        state: "queued",
        statusUrl: new URL(
          `/v1/demo/verifications/${accepted.interactionId}`,
          config.PUBLIC_APP_URL,
        ).toString(),
        expiresAt: accepted.expiresAt,
      };
      return reply.code(202).send(response);
    },
  );

  app.get(
    "/v1/demo/verifications/:interactionId",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const project = await demoProject();
      const { interactionId } = parseBody(InteractionParamsSchema, request.params);
      const verification = await verifications.get(interactionId);
      if (!verification || verification.projectId !== project._id) {
        throw new ApiError("verification_not_found", 404);
      }
      reply.header("cache-control", "no-store");
      return verifications.toStatus(verification);
    },
  );
}
