import { createAlertQueue, createAlertWorker, scheduleAlertChecks } from "@powerotp/api/alert-worker.js";
import { AuthService } from "@powerotp/api/auth-service.js";
import { createCallbackWorker } from "@powerotp/api/callback-worker.js";
import { ChallengeService } from "@powerotp/api/challenge-service.js";
import { loadConfig, type ProductionConfig } from "@powerotp/api/config.js";
import { connectDataStores, type DataStores } from "@powerotp/api/dependencies.js";
import { createBrevoEmailService } from "@powerotp/api/email.js";
import { ModalSessionService } from "@powerotp/api/modal-session-service.js";
import { NodeService } from "@powerotp/api/node-service.js";
import { ensureIndexes } from "@powerotp/api/persistence.js";
import { createProviderReconcileWorker } from "@powerotp/api/provider-reconcile-worker.js";
import { ProjectService } from "@powerotp/api/project-service.js";
import { productionTransportRegistry } from "@powerotp/api/transport.js";
import {
  createDispatchWorker,
  createVerificationQueues,
  toQueueConnectionOptions,
  type VerificationQueues,
} from "@powerotp/api/verification-queue.js";
import { VerificationService } from "@powerotp/api/verification-service.js";

export interface ServerContext {
  config: ProductionConfig;
  dataStores: DataStores;
  auth: AuthService;
  projects: ProjectService;
  verifications: VerificationService;
  nodes: NodeService;
  challenges: ChallengeService;
  modalSessions: ModalSessionService;
  queues: VerificationQueues;
}

/**
 * Every dependency (database, queues, background workers, services) is
 * built exactly once per server process and memoized here, the same
 * dependency graph the old standalone server built at boot. Next.js Route
 * Handlers are stateless functions, so this is the one place that owns
 * long-lived resources; `instrumentation.ts` calls this eagerly at server
 * start so the app fails fast on bad configuration instead of on the
 * first request.
 */
let contextPromise: Promise<ServerContext> | undefined;

async function buildServerContext(): Promise<ServerContext> {
  const config = loadConfig();
  const dataStores = await connectDataStores(config);
  await ensureIndexes(dataStores.db);

  const challenges = new ChallengeService(dataStores.db, config);
  const queueConnection = toQueueConnectionOptions(config.VALKEY_URL);
  const queues = createVerificationQueues(queueConnection);
  const verifications = new VerificationService(
    dataStores.db,
    config,
    challenges,
    queues.enqueueDispatch,
    queues.enqueueTimeout,
    queues.enqueueCallback,
    queues.enqueueProviderReconcile,
  );
  const dispatchWorker = createDispatchWorker(
    queueConnection,
    verifications,
    productionTransportRegistry(config),
  );
  const callbackWorker = createCallbackWorker(queueConnection, dataStores.db, config);
  const providerReconcileWorker = createProviderReconcileWorker(queueConnection, dataStores.db, config);

  const emailService = createBrevoEmailService(config);
  const auth = new AuthService(dataStores.db, config, emailService);
  const projects = new ProjectService(dataStores.db, config, verifications);
  const nodes = new NodeService(dataStores.db, config);
  const modalSessions = new ModalSessionService(dataStores.db);

  // Platform operator alerting (queue backlog / high failure rate / stale
  // node) — see `docs/AS_BUILT.md`'s "Admin operator health dashboard"
  // section. `scheduleAlertChecks` is idempotent (stable jobId), so it's
  // safe to call on every boot.
  const alertQueue = createAlertQueue(queueConnection);
  const alertWorker = createAlertWorker(queueConnection, dataStores.db, config, queues, nodes, emailService);
  await scheduleAlertChecks(alertQueue);

  async function shutdown(signal: string) {
    console.info(JSON.stringify({ service: "powerotp", signal, msg: "shutting down" }));
    await Promise.allSettled([
      dispatchWorker.close(),
      callbackWorker.close(),
      providerReconcileWorker.close(),
      alertWorker.close(),
      alertQueue.close(),
      queues.close(),
    ]);
    await dataStores.close();
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  return { config, dataStores, auth, projects, verifications, nodes, challenges, modalSessions, queues };
}

export function getServerContext(): Promise<ServerContext> {
  contextPromise ??= buildServerContext();
  return contextPromise;
}
