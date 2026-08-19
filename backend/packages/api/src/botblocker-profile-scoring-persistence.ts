import type { ProfileScoringConfiguration } from "@powerotp/contracts";
import type { Collection, Db } from "mongodb";

export interface ProfileScoringConfigurationDocument {
  _id: "active";
  configuration: ProfileScoringConfiguration;
  updatedBy: string;
  updatedAt: Date;
}

const COLLECTION_NAME = "botblockerProfileScoringConfiguration";

export async function ensureBotBlockerProfileScoringIndexes(
  _db: Db,
): Promise<void> {
  // The fixed `_id: "active"` is the collection's only row and unique index.
}

export class BotBlockerProfileScoringPersistence {
  readonly #configuration: Collection<ProfileScoringConfigurationDocument>;

  constructor(db: Db) {
    this.#configuration = db.collection<ProfileScoringConfigurationDocument>(
      COLLECTION_NAME,
    );
  }

  getConfiguration() {
    return this.#configuration.findOne({ _id: "active" });
  }

  async replaceConfiguration(input: {
    configuration: ProfileScoringConfiguration;
    updatedBy: string;
    now: Date;
  }): Promise<ProfileScoringConfigurationDocument> {
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
      throw new Error("BotBlocker profile scoring configuration was not stored");
    }
    return document;
  }
}
