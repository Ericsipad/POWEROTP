import type { Db } from "mongodb";

export interface BotBlockerSiteDocument {
  _id: string;
  projectId: string;
  customerId: string;
  /** Opaque, project-scoped URL segment for every runtime route (see
   * `BotBlockerWebhookIdSchema`). Independent from `_id`/`siteId` so it can
   * be rotated later without changing the site's internal identity. */
  webhookId: string;
  enabled: boolean;
  decisionTimeoutMs: number;
  /** Atomic monotonic publication head. Releases remain append-only; this
   * pointer prevents concurrent publication from inserting a rollback. */
  latestPolicyVersion?: number;
  latestPolicyReleaseId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function ensureBotBlockerSiteIndexes(db: Db): Promise<void> {
  await Promise.all([
    db
      .collection<BotBlockerSiteDocument>("botblockerSites")
      .createIndex({ projectId: 1 }, { unique: true }),
    db
      .collection<BotBlockerSiteDocument>("botblockerSites")
      .createIndex({ webhookId: 1 }, { unique: true }),
    db
      .collection<BotBlockerSiteDocument>("botblockerSites")
      .createIndex({ customerId: 1, updatedAt: -1 }),
  ]);
}
