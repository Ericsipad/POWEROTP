import type { BotBlockerOtpMethodMarkers } from "@powerotp/contracts";
import type { Db } from "mongodb";

export interface BotBlockerSiteDocument {
  _id: string;
  projectId: string;
  customerId: string;
  /** Immutable, self-validating project/site-scoped runtime endpoint token. */
  webhookId: string;
  /** Independent callback-signing secret, authenticated-encrypted at rest. */
  webhookSigningSecretEncrypted: string;
  enabled: boolean;
  decisionTimeoutMs: number;
  otpMethodMarkers?: BotBlockerOtpMethodMarkers;
  otpPolicyVersion?: number;
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
