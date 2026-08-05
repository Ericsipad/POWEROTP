import {
  CreateProjectSchema,
  UpdateProjectSchema,
} from "@powerotp/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthService } from "./auth-service.js";
import { ApiError, parseBody } from "./errors.js";
import { clientIp, header } from "./http-helpers.js";
import type { ProjectService } from "./project-service.js";
import type { VerificationService } from "./verification-service.js";

const SESSION_COOKIE = "powerotp_session";
const ProjectParamsSchema = z.object({
  projectId: z.string().min(16).max(80),
});
const CallbackSchema = z.object({
  callbackUrl: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", "HTTPS is required"),
});

async function customerSession(request: FastifyRequest, auth: AuthService) {
  const authenticated = await auth.authenticate(
    request.cookies[SESSION_COOKIE],
  );
  if (authenticated.user.accountClass !== "customer") {
    throw new ApiError("customer_access_required", 403);
  }
  return authenticated;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  auth: AuthService,
  projects: ProjectService,
  verifications: VerificationService,
) {
  app.get("/v1/projects", async (request, reply) => {
    const authenticated = await customerSession(request, auth);
    reply.header("cache-control", "no-store");
    return {
      projects: await projects.list(authenticated.user._id),
    };
  });

  app.post("/v1/projects", async (request, reply) => {
    const authenticated = await customerSession(request, auth);
    auth.verifyCsrf(authenticated.session, header(request, "x-csrf-token"));
    const created = await projects.create(
      authenticated.user._id,
      parseBody(CreateProjectSchema, request.body),
      clientIp(request),
    );
    reply.header("cache-control", "no-store");
    return reply.code(201).send(created);
  });

  app.patch("/v1/projects/:projectId", async (request) => {
    const authenticated = await customerSession(request, auth);
    auth.verifyCsrf(authenticated.session, header(request, "x-csrf-token"));
    const { projectId } = parseBody(ProjectParamsSchema, request.params);
    return projects.update(
      authenticated.user._id,
      projectId,
      parseBody(UpdateProjectSchema, request.body),
      clientIp(request),
    );
  });

  app.post("/v1/projects/:projectId/rotate-api-key", async (request, reply) => {
    const authenticated = await customerSession(request, auth);
    auth.verifyCsrf(authenticated.session, header(request, "x-csrf-token"));
    const { projectId } = parseBody(ProjectParamsSchema, request.params);
    const value = await projects.rotateApiKey(
      authenticated.user._id,
      projectId,
      clientIp(request),
    );
    reply.header("cache-control", "no-store");
    return { value };
  });

  app.get("/v1/projects/:projectId/interactions", async (request, reply) => {
    const authenticated = await customerSession(request, auth);
    const { projectId } = parseBody(ProjectParamsSchema, request.params);
    await projects.assertOwned(authenticated.user._id, projectId);
    reply.header("cache-control", "no-store");
    return { interactions: await verifications.listInteractions(projectId) };
  });

  app.post("/v1/projects/:projectId/callback", async (request, reply) => {
    const authenticated = await customerSession(request, auth);
    auth.verifyCsrf(authenticated.session, header(request, "x-csrf-token"));
    const { projectId } = parseBody(ProjectParamsSchema, request.params);
    const { callbackUrl } = parseBody(CallbackSchema, request.body);
    const value = await projects.rotateCallback(
      authenticated.user._id,
      projectId,
      callbackUrl,
      clientIp(request),
    );
    reply.header("cache-control", "no-store");
    return { value };
  });
}
