import {
  CodeSubmissionSchema,
  CreateVerificationSchema,
  type VerificationAccepted,
} from "@powerotp/contracts";
import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { z } from "zod";

import type { ProductionConfig } from "./config.js";
import { ApiError, parseBody } from "./errors.js";
import { header } from "./http-helpers.js";
import { issueInteractionToken, verifyInteractionToken } from "./interaction-tokens.js";
import { authenticateApiKey, authenticateProjectApiKey } from "./project-api-auth.js";
import type { VerificationService } from "./verification-service.js";

const SlugParamsSchema = z.object({ slug: z.string().min(3).max(48) });
const InteractionParamsSchema = z.object({ interactionId: z.string().min(16).max(80) });

const tokenActionByType = {
  voice_code: "submit_code",
  voice_challenge: "submit_challenge",
} as const;

export function registerVerificationRoutes(
  app: FastifyInstance,
  db: Db,
  config: Pick<ProductionConfig, "API_KEY_HASH_SECRET" | "INTERACTION_TOKEN_SECRET">,
  verifications: VerificationService,
) {
  app.post(
    "/v1/projects/:slug/verifications",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { slug } = parseBody(SlugParamsSchema, request.params);
      const project = await authenticateProjectApiKey(
        db,
        config,
        slug,
        header(request, "authorization"),
      );

      const idempotencyKey = header(request, "idempotency-key");
      if (!idempotencyKey) throw new ApiError("idempotency_key_required", 400);

      const input = parseBody(CreateVerificationSchema, request.body);
      if (!project.enabledMethods.includes(input.type)) {
        throw new ApiError("method_not_enabled", 403);
      }

      const accepted = await verifications.create(
        project._id,
        project.customerId,
        input,
        idempotencyKey,
        request.id,
      );

      const tokenAction =
        input.type === "voice_code" || input.type === "voice_challenge"
          ? tokenActionByType[input.type]
          : undefined;
      const origin = header(request, "origin");
      let interactionToken: string | undefined;
      if (input.browserResponse && tokenAction && origin && project.allowedOrigins.includes(origin)) {
        const issued = issueInteractionToken(config.INTERACTION_TOKEN_SECRET, {
          projectId: project._id,
          interactionId: accepted.interactionId,
          action: tokenAction,
          audience: origin,
        });
        await verifications.attachInteractionToken(accepted.interactionId, issued.nonce);
        interactionToken = issued.token;
      }

      reply.header("cache-control", "no-store");
      const response: VerificationAccepted = {
        interactionId: accepted.interactionId,
        state: "queued",
        statusUrl: accepted.statusUrl,
        expiresAt: accepted.expiresAt,
        interactionToken,
      };
      return reply.code(202).send(response);
    },
  );

  app.get("/v1/verifications/:interactionId", async (request, reply) => {
    const { interactionId } = parseBody(InteractionParamsSchema, request.params);
    const project = await authenticateApiKey(db, config, header(request, "authorization"));
    const verification = await verifications.get(interactionId);
    if (!verification || verification.projectId !== project._id) {
      throw new ApiError("verification_not_found", 404);
    }
    reply.header("cache-control", "no-store");
    return verifications.toStatus(verification);
  });

  app.post(
    "/v1/verifications/:interactionId/response",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { interactionId } = parseBody(InteractionParamsSchema, request.params);
      const { code } = parseBody(CodeSubmissionSchema, request.body);
      const verification = await verifications.get(interactionId);
      if (!verification) throw new ApiError("verification_not_found", 404);

      const interactionTokenHeader = header(request, "x-interaction-token");
      if (interactionTokenHeader) {
        const origin = header(request, "origin") ?? "";
        const claims = verifyInteractionToken(
          interactionTokenHeader,
          config.INTERACTION_TOKEN_SECRET,
          {
            projectId: verification.projectId,
            interactionId,
            action: "submit_code",
            audience: origin,
          },
        );
        const consumed = await verifications.consumeInteractionToken(
          interactionId,
          claims.nonce,
        );
        if (!consumed) throw new ApiError("interaction_token_replayed", 409);
      } else {
        const project = await authenticateApiKey(db, config, header(request, "authorization"));
        if (project._id !== verification.projectId) {
          throw new ApiError("verification_not_found", 404);
        }
      }

      reply.header("cache-control", "no-store");
      return verifications.submitCode(interactionId, code);
    },
  );
}
