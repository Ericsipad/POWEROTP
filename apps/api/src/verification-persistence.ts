import type { VerificationState, VerificationType } from "@powerotp/contracts";
import type { Db } from "mongodb";

export interface VerificationRequestDocument {
  _id: string;
  projectId: string;
  customerId: string;
  type: VerificationType;
  targetNumber: string;
  state: VerificationState;
  reasonCode?: string;
  sequence: number;
  correlationId: string;
  browserResponse: boolean;
  expectedCode?: string;
  answerOptionId?: string;
  interactionTokenNonce?: string;
  interactionTokenConsumedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface VerificationEventDocument {
  _id: string;
  interactionId: string;
  projectId: string;
  sequence: number;
  type: VerificationType;
  state: VerificationState;
  reasonCode?: string;
  occurredAt: Date;
}

export interface IdempotencyRecordDocument {
  _id: string;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
  interactionId: string;
  createdAt: Date;
}

export interface CallbackDeliveryDocument {
  _id: string;
  interactionId: string;
  eventId: string;
  projectId: string;
  attempt: number;
  status: "delivered" | "failed";
  statusCode?: number;
  error?: string;
  occurredAt: Date;
}

export function idempotencyRecordId(projectId: string, idempotencyKey: string) {
  return `${projectId}:${idempotencyKey}`;
}

export async function ensureVerificationIndexes(db: Db) {
  await Promise.all([
    db
      .collection<VerificationRequestDocument>("verificationRequests")
      .createIndex({ projectId: 1, createdAt: -1 }),
    db
      .collection<VerificationRequestDocument>("verificationRequests")
      .createIndex({ state: 1, expiresAt: 1 }),
    db
      .collection<VerificationEventDocument>("verificationEvents")
      .createIndex({ interactionId: 1, sequence: 1 }, { unique: true }),
    db
      .collection<IdempotencyRecordDocument>("idempotencyRecords")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }),
    db
      .collection<CallbackDeliveryDocument>("callbackDeliveries")
      .createIndex({ interactionId: 1, occurredAt: -1 }),
  ]);
}
