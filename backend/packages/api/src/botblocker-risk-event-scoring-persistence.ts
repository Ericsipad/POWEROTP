import type { RiskEventScoringConfiguration } from "@powerotp/contracts";
import type { ClientSession, Collection, Db } from "mongodb";

export interface RiskEventScoringConfigurationDocument {
  _id: "active";
  configuration: RiskEventScoringConfiguration;
  updatedBy: string;
  updatedAt: Date;
}

const COLLECTION_NAME = "botblockerRiskEventScoringConfiguration";

export async function ensureBotBlockerRiskEventScoringIndexes(
  _db: Db,
): Promise<void> {
  // The fixed `_id: "active"` is the collection's only row and unique index.
}

export class BotBlockerRiskEventScoringPersistence {
  readonly #configuration: Collection<RiskEventScoringConfigurationDocument>;

  constructor(db: Db) {
    this.#configuration = db.collection<RiskEventScoringConfigurationDocument>(
      COLLECTION_NAME,
    );
  }

  getConfiguration(session?: ClientSession) {
    return this.#configuration.findOne(
      { _id: "active" },
      session ? { session } : undefined,
    );
  }

  async replaceConfiguration(input: {
    configuration: RiskEventScoringConfiguration;
    updatedBy: string;
    now: Date;
  }): Promise<RiskEventScoringConfigurationDocument> {
    const document = await this.#configuration.findOneAndUpdate(
      { _id: "active" },
      {
        $set: {
          configuration: input.configuration,
          updatedBy: input.updatedBy,
          updatedAt: input.now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!document) {
      throw new Error("BotBlocker risk-event scoring configuration was not stored");
    }
    return document;
  }
}
