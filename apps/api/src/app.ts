import Fastify from "fastify";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { verificationStates, verificationTypes } from "@powerotp/contracts";
import type { Redis } from "ioredis";

import { AuthError, type AuthService } from "./auth-service.js";
import { registerAuthRoutes } from "./auth-routes.js";
import type { ProductionConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { ProjectError, type ProjectService } from "./project-service.js";
import { registerProjectRoutes } from "./project-routes.js";

export interface AppReadiness {
  rateLimitStore?: Redis;
  isReady(): Promise<boolean>;
}

export interface Phase2Services {
  auth: AuthService;
  config: Pick<ProductionConfig, "PUBLIC_APP_URL">;
  projects: ProjectService;
}

const alwaysReady: AppReadiness = {
  async isReady() {
    return true;
  },
};

export function buildApp(
  dependencies: AppReadiness = alwaysReady,
  phase2?: Phase2Services,
) {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.code",
          "req.body.password",
          "req.body.totpCode",
          "req.body.token",
          "req.headers.x-admin-bootstrap-token",
          "res.headers.set-cookie",
        ],
        censor: "[REDACTED]",
      },
    },
    trustProxy: true,
  });

  void app.register(cookie);
  void app.register(helmet, {
    contentSecurityPolicy: false,
  });
  void app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => request.ip,
    ...(dependencies.rateLimitStore
      ? { redis: dependencies.rateLimitStore }
      : {}),
  });

  app.setErrorHandler((error, request, reply) => {
    if (
      error instanceof ApiError ||
      error instanceof AuthError ||
      error instanceof ProjectError
    ) {
      return reply.code(error.statusCode).send({ error: error.code });
    }
    const frameworkStatus =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    if (frameworkStatus !== undefined && frameworkStatus < 500) {
      const frameworkCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "request_rejected";
      return reply
        .code(frameworkStatus)
        .send({ error: frameworkCode });
    }
    request.log.error({ error }, "request failed");
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => ({
    service: "powerotp-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  app.get("/ready", async (_request, reply) => {
    const ready = await dependencies.isReady();
    return reply.code(ready ? 200 : 503).send({
      service: "powerotp-api",
      status: ready ? "ready" : "unavailable",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/v1/capabilities", async () => ({
    verificationStates,
    verificationTypes,
  }));

  if (phase2) {
    registerAuthRoutes(app, phase2.auth, phase2.config);
    registerProjectRoutes(app, phase2.auth, phase2.projects);
  }

  return app;
}
