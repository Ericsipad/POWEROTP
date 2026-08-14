import type { Db } from "mongodb";

export interface BotBlockerSiteDocument {
  _id: string;
  projectId: string;
  customerId: string;
  enabled: boolean;
  decisionTimeoutMs: number;
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
      .createIndex({ customerId: 1, updatedAt: -1 }),
  ]);
}
