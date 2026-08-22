import type { Collection, Db, MongoClient } from "mongodb";

import {
  HostedAuthDiditReconciliationError,
  type HostedAuthDiditReconciliationDisposition,
  type HostedAuthDiditReconciliationRepository,
  type HostedAuthDiditReconciliationSnapshot,
} from "./hosted-auth-didit-reconciliation.js";
import {
  HostedAuthDiditWebhookError,
  type HostedAuthDiditWebhookDisposition,
  type HostedAuthDiditWebhookEvent,
  type HostedAuthDiditWebhookRepository,
} from "./hosted-auth-didit-webhook.js";

export const HOSTED_AUTH_DIDIT_WEBHOOK_EVENT_COLLECTION =
  "hostedAuthDiditWebhookEvents";
export const HOSTED_AUTH_DIDIT_WEBHOOK_CURSOR_COLLECTION =
  "hostedAuthDiditWebhookCursors";

interface DiditWebhookEventDocument extends HostedAuthDiditWebhookEvent {
  _id: string;
}

interface DiditWebhookCursorDocument {
  _id: string;
  eventId?: string;
  eventType?: HostedAuthDiditWebhookEvent["eventType"];
  applicationId?: string;
  environment: HostedAuthDiditWebhookEvent["environment"];
  potpDiditId: string;
  workflowId?: string;
  status: string;
  source: "webhook" | "poll";
  providerCreatedAt?: Date;
  receivedAt?: Date;
  reconciledAt?: Date;
}

/**
 * Records the stable Didit event ID and advances one session cursor in the
 * same transaction, so a crash cannot consume an event without ordering it.
 */
export class MongoHostedAuthDiditWebhookRepository
  implements
    HostedAuthDiditWebhookRepository,
    HostedAuthDiditReconciliationRepository
{
  private readonly events: Collection<DiditWebhookEventDocument>;
  private readonly cursors: Collection<DiditWebhookCursorDocument>;

  constructor(
    db: Db,
    private readonly client: Pick<MongoClient, "startSession">,
  ) {
    this.events = db.collection(HOSTED_AUTH_DIDIT_WEBHOOK_EVENT_COLLECTION);
    this.cursors = db.collection(HOSTED_AUTH_DIDIT_WEBHOOK_CURSOR_COLLECTION);
  }

  async record(
    event: HostedAuthDiditWebhookEvent,
  ): Promise<HostedAuthDiditWebhookDisposition> {
    const session = this.client.startSession();
    let disposition: HostedAuthDiditWebhookDisposition | undefined;
    try {
      await session.withTransaction(async () => {
        const existing = await this.events.findOne(
          { _id: event.eventId },
          { session },
        );
        if (existing) {
          if (existing.payloadDigest !== event.payloadDigest) {
            throw new HostedAuthDiditWebhookError("conflicting_replay");
          }
          disposition = "replayed";
          return;
        }

        const cursor = await this.cursors.findOne(
          { _id: event.providerOperationId },
          { session },
        );
        requireSameBinding(cursor, event);
        disposition =
          cursor?.providerCreatedAt &&
          cursor.providerCreatedAt > event.providerCreatedAt
            ? "stale"
            : "accepted";
        await this.events.insertOne(
          { _id: event.eventId, ...event },
          { session },
        );
        if (disposition === "accepted") {
          await this.cursors.updateOne(
            { _id: event.providerOperationId },
            {
              $set: {
                eventId: event.eventId,
                eventType: event.eventType,
                applicationId: event.applicationId,
                environment: event.environment,
                potpDiditId: event.potpDiditId,
                ...(event.workflowId ? { workflowId: event.workflowId } : {}),
                status: event.status,
                source: "webhook",
                providerCreatedAt: event.providerCreatedAt,
                receivedAt: event.receivedAt,
              },
            },
            { session, upsert: true },
          );
        }
      });
    } finally {
      await session.endSession();
    }
    if (!disposition) {
      throw new Error("Didit webhook transaction completed without an outcome");
    }
    return disposition;
  }

  async reconcile(
    snapshot: HostedAuthDiditReconciliationSnapshot,
  ): Promise<HostedAuthDiditReconciliationDisposition> {
    const session = this.client.startSession();
    let disposition: HostedAuthDiditReconciliationDisposition | undefined;
    try {
      await session.withTransaction(async () => {
        const cursor = await this.cursors.findOne(
          { _id: snapshot.providerOperationId },
          { session },
        );
        requireSameBinding(cursor, snapshot);
        disposition = cursor?.status === snapshot.status ? "unchanged" : "accepted";
        await this.cursors.updateOne(
          { _id: snapshot.providerOperationId },
          {
            $set: {
              environment: snapshot.environment,
              potpDiditId: snapshot.potpDiditId,
              workflowId: snapshot.workflowId,
              status: snapshot.status,
              ...(disposition === "accepted" ? { source: "poll" as const } : {}),
              reconciledAt: snapshot.reconciledAt,
            },
          },
          { session, upsert: true },
        );
      });
    } finally {
      await session.endSession();
    }
    if (!disposition) {
      throw new Error("Didit reconciliation completed without an outcome");
    }
    return disposition;
  }
}

function requireSameBinding(
  cursor: DiditWebhookCursorDocument | null,
  update:
    | HostedAuthDiditWebhookEvent
    | HostedAuthDiditReconciliationSnapshot,
): void {
  if (
    cursor &&
    (cursor.potpDiditId !== update.potpDiditId ||
      cursor.environment !== update.environment ||
      (cursor.workflowId &&
        update.workflowId &&
        cursor.workflowId !== update.workflowId))
  ) {
    throw new HostedAuthDiditReconciliationError("provider_binding_mismatch");
  }
}
