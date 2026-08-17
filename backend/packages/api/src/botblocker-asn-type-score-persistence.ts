import { asnTypes, type AsnType, type OperatorAsnTypeScoreEntry } from "@powerotp/contracts";
import type { Collection, Db } from "mongodb";

/**
 * `botblockerAsnTypeScores` (Phase 16 network-intelligence design,
 * execution step 4): an admin-configurable score plus an
 * API-lookup-requirement switch per ASN *type* (not per ASN) — exactly
 * five possible rows, one per `AsnTypeSchema` member. `score` starts at
 * `0`/neutral and `requiresApiLookup` starts `false` for every type until
 * an admin sets them, never a fabricated "real" risk number. Per the
 * user: "admin page will have a number entry for each ASN type that will
 * dynamically adjust scoring." A later step reads this from the
 * fast-immediate branch's ranges -> classification -> type-score chain;
 * nothing here is called from `rapidAuthMutation` yet.
 */
export interface AsnTypeScoreDocument {
  _id: AsnType;
  score: number;
  requiresApiLookup: boolean;
  updatedAt: Date;
  updatedBy: string;
}

const COLLECTION_NAME = "botblockerAsnTypeScores";

/**
 * No index beyond MongoDB's own default `_id` index is needed: `_id` is
 * the ASN type itself (the natural, already-unique lookup key), and the
 * collection is capped at exactly five rows. This export exists anyway
 * to match the `ensureBotBlocker*Indexes` registration convention every
 * other BotBlocker collection follows.
 */
export async function ensureBotBlockerAsnTypeScoreIndexes(_db: Db): Promise<void> {
  // Intentionally a no-op — see the doc comment above.
}

function defaultScore(asnType: AsnType): AsnTypeScoreDocument {
  return {
    _id: asnType,
    score: 0,
    requiresApiLookup: false,
    updatedAt: new Date(0),
    updatedBy: "",
  };
}

export function toAsnTypeScoreResponse(
  entry: AsnTypeScoreDocument,
  persisted: boolean,
): OperatorAsnTypeScoreEntry {
  return {
    asnType: entry._id,
    score: entry.score,
    requiresApiLookup: entry.requiresApiLookup,
    ...(persisted
      ? { updatedBy: entry.updatedBy, updatedAt: entry.updatedAt.toISOString() }
      : {}),
  };
}

export class BotBlockerAsnTypeScorePersistence {
  readonly #typeScores: Collection<AsnTypeScoreDocument>;

  constructor(db: Db) {
    this.#typeScores = db.collection<AsnTypeScoreDocument>(COLLECTION_NAME);
  }

  async upsertScore(input: {
    asnType: AsnType;
    score: number;
    requiresApiLookup: boolean;
    updatedBy: string;
    now: Date;
  }): Promise<AsnTypeScoreDocument> {
    const entry = await this.#typeScores.findOneAndUpdate(
      { _id: input.asnType },
      {
        $set: {
          score: input.score,
          requiresApiLookup: input.requiresApiLookup,
          updatedBy: input.updatedBy,
          updatedAt: input.now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!entry) throw new Error("BotBlocker ASN type score upsert did not return a document");
    return entry;
  }

  /** Returns exactly one row per `AsnTypeSchema` member, synthesizing an
   * unpersisted `{ score: 0, requiresApiLookup: false }` default for any
   * type an admin has not yet configured, so the admin page's "number
   * entry for each ASN type" is always fully populated. */
  async listAllScores(): Promise<
    Array<{ document: AsnTypeScoreDocument; persisted: boolean }>
  > {
    const persistedEntries = await this.#typeScores.find({}).toArray();
    const byType = new Map(persistedEntries.map((entry) => [entry._id, entry]));
    return asnTypes.map((asnType) => {
      const existing = byType.get(asnType);
      return existing
        ? { document: existing, persisted: true }
        : { document: defaultScore(asnType), persisted: false };
    });
  }
}
