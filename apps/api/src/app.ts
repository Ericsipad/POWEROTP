import Fastify from "fastify";

import { verificationStates, verificationTypes } from "@powerotp/contracts";

export interface AppDependencies {
  isReady(): Promise<boolean>;
}

const alwaysReady: AppDependencies = {
  async isReady() {
    return true;
  },
};

export function buildApp(dependencies: AppDependencies = alwaysReady) {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.code",
          "req.body.token",
        ],
        censor: "[REDACTED]",
      },
    },
    trustProxy: true,
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

  return app;
}
