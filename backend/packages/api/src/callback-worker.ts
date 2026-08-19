import type {
  BotBlockerDataReadyCallbackEnvelope,
  CallbackEnvelope,
} from "@powerotp/contracts";
import { Worker, type ConnectionOptions } from "bullmq";
import type { Db } from "mongodb";

import { deliverCallback } from "./callback-dispatcher.js";
import type { ProductionConfig } from "./config.js";
import type { CallbackJobData } from "./verification-queue.js";
import { createSortableId, decryptString } from "./security.js";
import type {
  CallbackDeliveryDocument,
  VerificationEventDocument,
  VerificationRequestDocument,
} from "./verification-persistence.js";
import type { ProjectDocument } from "./persistence.js";

const CALLBACKS_QUEUE_NAME = "verification-callbacks";

export function createCallbackWorker(
  connection: ConnectionOptions,
  db: Db,
  config: Pick<ProductionConfig, "CONFIG_ENCRYPTION_KEY">,
) {
  const requests = db.collection<VerificationRequestDocument>("verificationRequests");
  const events = db.collection<VerificationEventDocument>("verificationEvents");
  const projects = db.collection<ProjectDocument>("projects");
  const deliveries = db.collection<CallbackDeliveryDocument>("callbackDeliveries");

  return new Worker<CallbackJobData>(
    CALLBACKS_QUEUE_NAME,
    async (job) => {
      if (job.data.kind === "botblocker_session_data_ready") {
        const { event } = job.data;
        const project = await projects.findOne({ _id: event.projectId });
        if (!project?.callbackUrl || !project.callbackSecretEncrypted) return;
        const secret = decryptString(
          project.callbackSecretEncrypted,
          config.CONFIG_ENCRYPTION_KEY,
        );
        const envelope: BotBlockerDataReadyCallbackEnvelope = {
          apiVersion: "2026-08-04",
          event,
        };
        const result = await deliverCallback(
          project.callbackUrl,
          JSON.stringify(envelope),
          secret,
        );
        if (!result.delivered) {
          throw new Error(
            result.error ??
              `Callback delivery failed with HTTP ${result.statusCode}`,
          );
        }
        return;
      }
      const { interactionId, eventId } = job.data;
      const [verification, event] = await Promise.all([
        requests.findOne({ _id: interactionId }),
        events.findOne({ _id: eventId }),
      ]);
      if (!verification || !event) return;

      const project = await projects.findOne({ _id: verification.projectId });
      if (!project?.callbackUrl || !project.callbackSecretEncrypted) return;

      const secret = decryptString(project.callbackSecretEncrypted, config.CONFIG_ENCRYPTION_KEY);
      const envelope: CallbackEnvelope = {
        apiVersion: "2026-08-04",
        event: {
          eventId: event._id,
          interactionId: event.interactionId,
          sequence: event.sequence,
          type: event.type,
          state: event.state,
          occurredAt: event.occurredAt.toISOString(),
          reasonCode: event.reasonCode,
        },
      };

      const result = await deliverCallback(project.callbackUrl, JSON.stringify(envelope), secret);
      await deliveries.insertOne({
        _id: createSortableId("cbd"),
        interactionId,
        eventId,
        projectId: verification.projectId,
        attempt: job.attemptsMade + 1,
        status: result.delivered ? "delivered" : "failed",
        statusCode: result.statusCode,
        error: result.error,
        occurredAt: new Date(),
      });

      if (!result.delivered) {
        throw new Error(result.error ?? `Callback delivery failed with HTTP ${result.statusCode}`);
      }
    },
    { connection },
  );
}
