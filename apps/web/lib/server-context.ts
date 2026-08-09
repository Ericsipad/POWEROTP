import { createAlertQueue, createAlertWorker, scheduleAlertChecks } from "@powerotp/api/alert-worker.js";
import { AuthService } from "@powerotp/api/auth-service.js";
import { BalanceService } from "@powerotp/api/balance-service.js";
import { BillingChargeService } from "@powerotp/api/billing-charge-service.js";
import {
  createBillingDailyChargeQueue,
  createBillingDailyChargeWorker,
  scheduleBillingDailyCharges,
} from "@powerotp/api/billing-daily-charge-worker.js";
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
import { RateChartService } from "@powerotp/api/rate-chart-service.js";
import { StripeTopupService } from "@powerotp/api/stripe-service.js";
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
  balances: BalanceService;
  rateCharts: RateChartService;
  stripeTopups: StripeTopupService;
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

  const balances = new BalanceService(dataStores.client, dataStores.db);
  const rateCharts = new RateChartService(dataStores.db);
  const billingCharges = new BillingChargeService(dataStores.db, balances, rateCharts);
  const stripeTopups = new StripeTopupService(dataStores.db, config, balances);

  const verifications = new VerificationService(
    dataStores.db,
    config,
    challenges,
    queues.enqueueDispatch,
    queues.enqueueTimeout,
    queues.enqueueCallback,
    queues.enqueueProviderReconcile,
    (customerId) => balances.requireNonNegativeBalance(customerId),
    (verification) => billingCharges.chargeCompletedInteraction(verification),
  );
  const dispatchWorker = createDispatchWorker(
    queueConnection,
    verifications,
    productionTransportRegistry(config),
  );
  const callbackWorker = createCallbackWorker(queueConnection, dataStores.db, config);
  const providerReconcileWorker = createProviderReconcileWorker(queueConnection, dataStores.db, config);

  // Daily per-project plan-charge tick — see
  // `apps/api/src/billing-daily-charge-worker.ts` and docs/AS_BUILT.md's
  // "Customer balance billing" section.
  const billingDailyChargeQueue = createBillingDailyChargeQueue(queueConnection);
  const billingDailyChargeWorker = createBillingDailyChargeWorker(
    queueConnection,
    dataStores.db,
    balances,
    rateCharts,
  );
  await scheduleBillingDailyCharges(billingDailyChargeQueue);

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
      billingDailyChargeWorker.close(),
      billingDailyChargeQueue.close(),
      queues.close(),
    ]);
    await dataStores.close();
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  return {
    config,
    dataStores,
    auth,
    projects,
    verifications,
    nodes,
    challenges,
    modalSessions,
    queues,
    balances,
    rateCharts,
    stripeTopups,
  };
}

export function getServerContext(): Promise<ServerContext> {
  contextPromise ??= buildServerContext();
  return contextPromise;
}
