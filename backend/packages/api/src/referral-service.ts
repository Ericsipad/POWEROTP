import type { ClientSession, Db, MongoClient } from "mongodb";

import type {
  AccountReferralAttributionDocument,
  ProjectReferralAttributionDocument,
  ReferralCodeDocument,
} from "./accounting-persistence.js";
import type { AuditDocument, ProjectDocument } from "./persistence.js";
import { createSortableId } from "./security.js";

const RESERVED_CODES = new Set([
  "admin",
  "api",
  "dashboard",
  "docs",
  "login",
  "privacy",
  "register",
  "signup",
  "terms",
  "verify-email",
  "widget",
]);

export class ReferralError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export class ReferralService {
  readonly #codes;
  readonly #accounts;
  readonly #projects;
  readonly #projectAttributions;
  readonly #audits;

  constructor(
    private readonly client: Pick<MongoClient, "startSession">,
    db: Db,
  ) {
    this.#codes = db.collection<ReferralCodeDocument>("referralCodes");
    this.#accounts = db.collection<AccountReferralAttributionDocument>("accountReferralAttributions");
    this.#projects = db.collection<ProjectDocument>("projects");
    this.#projectAttributions =
      db.collection<ProjectReferralAttributionDocument>("projectReferralAttributions");
    this.#audits = db.collection<AuditDocument>("auditEvents");
  }

  async createCode(userId: string, code: string): Promise<ReferralCodeDocument> {
    if (RESERVED_CODES.has(code)) throw new ReferralError("referral_code_reserved", 409);
    const existing = await this.#codes.findOne({ ownerUserId: userId, active: true });
    if (existing) throw new ReferralError("referral_code_already_exists", 409);
    const document: ReferralCodeDocument = {
      _id: code,
      ownerUserId: userId,
      active: true,
      createdAt: new Date(),
    };
    const session = this.client.startSession() as ClientSession;
    try {
      try {
        await session.withTransaction(async () => {
          await this.#codes.insertOne(document, { session });
          await this.#audit(userId, "referral.code.created", "referral_code", code, session);
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const owned = await this.#codes.findOne({ ownerUserId: userId, active: true });
        throw new ReferralError(
          owned ? "referral_code_already_exists" : "referral_code_unavailable",
          409,
        );
      }
      return document;
    } finally {
      await session.endSession();
    }
  }

  async getOwnedCode(userId: string): Promise<ReferralCodeDocument | null> {
    return this.#codes.findOne({ ownerUserId: userId, active: true });
  }

  async resolve(code: string): Promise<ReferralCodeDocument | null> {
    return this.#codes.findOne({ _id: code, active: true });
  }

  async attributeAccount(userId: string, code: string): Promise<boolean> {
    const referral = await this.resolve(code);
    if (!referral || referral.ownerUserId === userId) return false;
    try {
      await this.#accounts.insertOne({
        _id: userId,
        referralCode: code,
        referrerUserId: referral.ownerUserId,
        attributedAt: new Date(),
      });
      return true;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      return (await this.#accounts.findOne({ _id: userId }))?.referralCode === code;
    }
  }

  async getProjectAttribution(projectId: string): Promise<ProjectReferralAttributionDocument | null> {
    return this.#projectAttributions.findOne({ projectId, endedAt: { $exists: false } });
  }

  async setProjectAttribution(
    actorId: string,
    projectId: string,
    code: string | null,
  ): Promise<ProjectReferralAttributionDocument | null> {
    const project = await this.#projects.findOne({ _id: projectId, customerId: actorId });
    if (!project) throw new ReferralError("project_not_found", 404);
    const referral = code ? await this.resolve(code) : null;
    if (code && (!referral || referral.ownerUserId === actorId)) {
      throw new ReferralError("invalid_project_referral", 400);
    }
    const session = this.client.startSession() as ClientSession;
    try {
      let created: ProjectReferralAttributionDocument | null = null;
      await session.withTransaction(async () => {
        const now = new Date();
        await this.#projectAttributions.updateMany(
          { projectId, endedAt: { $exists: false } },
          { $set: { endedAt: now } },
          { session },
        );
        if (referral && code) {
          created = {
            _id: createSortableId("pra"),
            projectId,
            referralCode: code,
            referrerUserId: referral.ownerUserId,
            startedAt: now,
            setBy: actorId,
          };
          await this.#projectAttributions.insertOne(created, { session });
        }
        await this.#audits.insertOne(
          {
            _id: createSortableId("aud"),
            actorId,
            action: "referral.project.updated",
            targetType: "project",
            targetId: projectId,
            occurredAt: now,
            details: { configured: Boolean(code) },
          },
          { session },
        );
      });
      return created;
    } finally {
      await session.endSession();
    }
  }

  async #audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    session?: ClientSession,
  ) {
    await this.#audits.insertOne(
      {
        _id: createSortableId("aud"),
        actorId,
        action,
        targetType,
        targetId,
        occurredAt: new Date(),
      },
      session ? { session } : undefined,
    );
  }
}
