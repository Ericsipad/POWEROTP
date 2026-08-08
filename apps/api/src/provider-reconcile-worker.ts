import { Worker, type ConnectionOptions } from "bullmq";
import type { Db } from "mongodb";

import type { ProductionConfig } from "./config.js";
import type { ProviderReconcileJobData } from "./verification-queue.js";
import { reconcileSmsInteraction, reconcileVoiceInteraction } from "./provider-reconcile-service.js";
import type { VerificationRequestDocument } from "./verification-persistence.js";
import { VoipMsBillingError } from "./voipms-billing-client.js";

const PROVIDER_RECONCILE_QUEUE_NAME = "verification-provider-reconcile";

/**
 * Runs `apps/api/src/provider-reconcile-service.ts` against VoIP.ms's
 * `getCDR`/`getSMS` a few minutes after an interaction's actual delivery
 * attempt finishes (see `VerificationService#transition`, which schedules
 * this) and persists whatever it finds — never anything customer-facing,
 * purely for the platform's own cost records (`docs/AS_BUILT.md`'s
 * "Provider cost reconciliation"). A "not yet in VoIP.ms's own records"
 * result is retried with BullMQ's built-in backoff (see
 * `verification-queue.ts#enqueueProviderReconcile`) rather than treated as
 * failure until the final attempt, since VoIP.ms's CDR/SMS logs are not
 * always immediately queryable right after a call/message completes.
 */
export function createProviderReconcileWorker(
  connection: ConnectionOptions,
  db: Db,
  config: ProductionConfig,
) {
  const requests = db.collection<VerificationRequestDocument>("verificationRequests");

  return new Worker<ProviderReconcileJobData>(
    PROVIDER_RECONCILE_QUEUE_NAME,
    async (job) => {
      const { interactionId } = job.data;
      const verification = await requests.findOne({ _id: interactionId });
      if (!verification) return;
      if (verification.providerRecordStatus === "matched") return;

      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

      let outcome;
      try {
        outcome =
          verification.type === "sms_code"
            ? await reconcileSmsInteraction(config, verification)
            : await reconcileVoiceInteraction(config, verification);
      } catch (error) {
        const reasonCode = error instanceof VoipMsBillingError ? error.reasonCode : "unknown";
        console.error(
          JSON.stringify({
            service: "powerotp-api",
            component: "provider-reconcile",
            msg: "reconciliation lookup failed",
            interactionId,
            reasonCode,
          }),
        );
        if (isLastAttempt) {
          await requests.updateOne({ _id: interactionId }, { $set: { providerRecordStatus: "error" } });
          return;
        }
        throw error;
      }

      if (outcome.status === "matched") {
        await requests.updateOne(
          { _id: interactionId },
          { $set: { providerRecord: outcome.record, providerRecordStatus: "matched" } },
        );
        return;
      }

      if (isLastAttempt) {
        await requests.updateOne(
          { _id: interactionId },
          { $set: { providerRecordStatus: "not_found" } },
        );
        return;
      }

      // Throwing (without setting a final status) triggers BullMQ's
      // configured backoff/retry for this job — the record may simply not
      // be in VoIP.ms's own logs yet.
      throw new Error("no matching VoIP.ms record found yet");
    },
    { connection },
  );
}
