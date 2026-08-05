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

const auth = new AuthService(
  dataStores.db,
  config,
  createBrevoEmailService(config),
);
const projects = new ProjectService(dataStores.db, config, verifications);
const app = buildApp(
  dataStores,
  { auth, config, projects },
  { db: dataStores.db, config, verifications },
);

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await Promise.allSettled([dispatchWorker.close(), callbackWorker.close(), queues.close()]);
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
