import { createRequire } from "node:module";
import path from "node:path";

import { createMcpHandler } from "@powerotp/mcp/mcp-app.js";
import type { NextServerOptions } from "next/dist/server/next.js";
import type { RequestHandler as NextRequestHandler } from "next/dist/server/next.js";

// Loaded via createRequire rather than a static import: next's public type
// re-exports do not currently expose a callable default for the
// programmatic custom-server API under NodeNext module resolution, so the
// runtime value is loaded dynamically and typed explicitly instead.
const next: (options: NextServerOptions) => {
  prepare(): Promise<void>;
  getRequestHandler(): NextRequestHandler;
  close(): Promise<void>;
} = createRequire(import.meta.url)("next/dist/server/next.js");

import { buildApp } from "./app.js";
import { AuthService } from "./auth-service.js";
import { createCallbackWorker } from "./callback-worker.js";
import { loadConfig } from "./config.js";
import { connectDataStores } from "./dependencies.js";
import { createBrevoEmailService } from "./email.js";
import { ensureIndexes } from "./persistence.js";
import { ProjectService } from "./project-service.js";
import { productionTransportRegistry } from "./transport.js";
import {
  createDispatchWorker,
  createVerificationQueues,
  toQueueConnectionOptions,
} from "./verification-queue.js";
import { VerificationService } from "./verification-service.js";

/**
 * POWEROTP deploys as one DigitalOcean App Platform component. This
 * process serves the marketing/dashboard site (Next.js), the customer and
 * verification API (Fastify, mounted under /v1), the durable background
 * queue workers, and the public MCP integration guide (mounted under
 * /mcp) — all in a single Node process, with Next.js as the catch-all for
 * every other path. There is no ingress path-routing between separate
 * services to keep in sync.
 */
const config = loadConfig();
const dataStores = await connectDataStores(config);
await ensureIndexes(dataStores.db);

const queueConnection = toQueueConnectionOptions(config.VALKEY_URL);
const queues = createVerificationQueues(queueConnection);
const verifications = new VerificationService(
  dataStores.db,
  config,
  queues.enqueueDispatch,
  queues.enqueueTimeout,
  queues.enqueueCallback,
);
const dispatchWorker = createDispatchWorker(
  queueConnection,
  verifications,
  productionTransportRegistry(),
);
const callbackWorker = createCallbackWorker(queueConnection, dataStores.db, config);

const auth = new AuthService(dataStores.db, config, createBrevoEmailService(config));
const projects = new ProjectService(dataStores.db, config, verifications);
const app = buildApp(
  dataStores,
  { auth, config, projects },
  { db: dataStores.db, config, verifications },
);

const mcpHandler = await createMcpHandler(config.PUBLIC_APP_URL);
app.route({
  method: ["GET", "POST", "DELETE"],
  url: "/mcp",
  handler: async (request, reply) => {
    reply.hijack();
    await mcpHandler.handleHttp(request.raw, reply.raw);
  },
});

const webApp = next({ dev: false, dir: path.resolve(process.cwd(), "../web") });
await webApp.prepare();
const handleWebRequest = webApp.getRequestHandler();
app.route({
  method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  url: "*",
  handler: async (request, reply) => {
    reply.hijack();
    await handleWebRequest(request.raw, reply.raw);
  },
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await Promise.allSettled([
    dispatchWorker.close(),
    callbackWorker.close(),
    queues.close(),
    mcpHandler.close(),
  ]);
  await dataStores.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: "0.0.0.0", port: config.PORT });
} catch (error) {
  app.log.error(error);
  await dataStores.close();
  process.exit(1);
}
