import type { AccountClass, VerificationType } from "@powerotp/contracts";
import type { Db } from "mongodb";

export interface UserDocument {
  _id: string;
  email: string;
  passwordHash: string;
  accountClass: AccountClass;
  emailVerifiedAt?: Date;
  totpSecretEncrypted?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDocument {
  _id: string;
  userId: string;
  csrfHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface EmailVerificationDocument {
  _id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ProjectDocument {
  _id: string;
  customerId: string;
  name: string;
  slug: string;
  enabledMethods: VerificationType[];
  allowedOrigins: string[];
  callbackUrl?: string;
  callbackSecretEncrypted?: string;
  active: boolean;
  activatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyDocument {
  _id: string;
  projectId: string;
  customerId: string;
  keyHash: string;
  prefix: string;
  lastFour: string;
  createdAt: Date;
  revokedAt?: Date;
}

export interface AuditDocument {
  _id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  occurredAt: Date;
  ip?: string;
  details?: Record<string, string | number | boolean>;
}

export async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection<UserDocument>("users").createIndex({ email: 1 }, { unique: true }),
    db
      .collection<SessionDocument>("sessions")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db
      .collection<SessionDocument>("sessions")
      .createIndex({ userId: 1, expiresAt: -1 }),
    db
      .collection<EmailVerificationDocument>("emailVerifications")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db
      .collection<ProjectDocument>("projects")
      .createIndex({ slug: 1 }, { unique: true }),
    db
      .collection<ProjectDocument>("projects")
      .createIndex({ customerId: 1, createdAt: -1 }),
    db
      .collection<ApiKeyDocument>("apiKeys")
      .createIndex({ keyHash: 1 }, { unique: true }),
    db
      .collection<ApiKeyDocument>("apiKeys")
      .createIndex({ projectId: 1, revokedAt: 1 }),
    db
      .collection<AuditDocument>("auditEvents")
      .createIndex({ actorId: 1, occurredAt: -1 }),
  ]);
}
