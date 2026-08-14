import {
  PolicyReleaseRecordSchema,
  type SignedBotBlockerPolicyRelease,
} from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import { createId } from "./security.js";

export interface BotBlockerPolicyScope {
  customerId: string;
  projectId: string;
  siteId: string;
}

export interface PolicyReleaseDocument extends BotBlockerPolicyScope {
  _id: string;
  policyVersion: number;
  protocolVersion: number;
  activatesAt: Date;
  expiresAt: Date;
  issuedAt: Date;
  release: SignedBotBlockerPolicyRelease;
  createdAt: Date;
}

export type PolicyPublicationResult = "inserted" | "policy_version_regression";

export async function ensureBotBlockerPolicyIndexes(db: Db): Promise<void> {
  const releases = db.collection<PolicyReleaseDocument>("policyReleases");
  await Promise.all([
    releases.createIndex(
      { customerId: 1, projectId: 1, siteId: 1, policyVersion: 1 },
      { unique: true },
    ),
    releases.createIndex({
      customerId: 1,
      projectId: 1,
      siteId: 1,
      policyVersion: -1,
      activatesAt: -1,
    }),
  ]);
}

/**
 * The collection is append-only. The only update is the monotonic head on
 * the owning site, performed in the same MongoDB transaction as insertion.
 */
export class BotBlockerPolicyPersistence {
  readonly #client: MongoClient;
  readonly #sites;
  readonly #releases;

  constructor(db: Db, client: MongoClient) {
    this.#client = client;
    this.#sites = db.collection<BotBlockerSiteDocument>("botblockerSites");
    this.#releases = db.collection<PolicyReleaseDocument>("policyReleases");
  }

  findSite(siteId: string) {
    return this.#sites.findOne({ _id: siteId });
  }

  async insertRelease(
    scope: BotBlockerPolicyScope,
    release: SignedBotBlockerPolicyRelease,
    createdAt: Date,
  ): Promise<PolicyPublicationResult> {
    const document = createDocument(scope, release, createdAt);
    validateDocument(document);
    let result: PolicyPublicationResult = "policy_version_regression";

    await this.#client.withSession(async (session) => {
      await session.withTransaction(async () => {
        result = "policy_version_regression";
        const advanced = await this.#sites.updateOne(
          {
            _id: scope.siteId,
            customerId: scope.customerId,
            projectId: scope.projectId,
            $or: [
              { latestPolicyVersion: { $exists: false } },
              { latestPolicyVersion: { $lt: document.policyVersion } },
            ],
          },
          {
            $set: {
              latestPolicyVersion: document.policyVersion,
              latestPolicyReleaseId: document._id,
            },
          },
          { session },
        );
        if (advanced.matchedCount !== 1) return;

        await this.#releases.insertOne(document, { session });
        result = "inserted";
      });
    });
    return result;
  }

  async findLatestActivatedRelease(
    scope: BotBlockerPolicyScope,
    activationCutoff: Date,
  ): Promise<PolicyReleaseDocument | null> {
    const document = await this.#releases.findOne(
      { ...scope, activatesAt: { $lte: activationCutoff } },
      { sort: { policyVersion: -1 } },
    );
    if (document) validateDocument(document);
    return document;
  }
}

function createDocument(
  scope: BotBlockerPolicyScope,
  release: SignedBotBlockerPolicyRelease,
  createdAt: Date,
): PolicyReleaseDocument {
  return {
    _id: createId("bpr"),
    ...scope,
    policyVersion: release.policy.policyVersion,
    protocolVersion: release.policy.protocolVersion,
    activatesAt: new Date(release.policy.activatesAt),
    expiresAt: new Date(release.policy.expiresAt),
    issuedAt: new Date(release.issuedAt),
    release,
    createdAt,
  };
}

function validateDocument(document: PolicyReleaseDocument): void {
  PolicyReleaseRecordSchema.parse({
    policyReleaseId: document._id,
    customerId: document.customerId,
    projectId: document.projectId,
    siteId: document.siteId,
    policyVersion: document.policyVersion,
    protocolVersion: document.protocolVersion,
    activatesAt: document.activatesAt.toISOString(),
    expiresAt: document.expiresAt.toISOString(),
    issuedAt: document.issuedAt.toISOString(),
    release: document.release,
    createdAt: document.createdAt.toISOString(),
  });
}
