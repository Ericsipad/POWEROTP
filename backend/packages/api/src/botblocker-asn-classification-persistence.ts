import type {
  AsnClassificationSource,
  AsnType,
  OperatorAsnClassificationEntry,
} from "@powerotp/contracts";
import type { Collection, Db, Filter } from "mongodb";

/**
 * `botblockerAsnClassifications` (Phase 16 network-intelligence design,
 * execution step 4): one row per unique ASN. MaxMind GeoLite2 only
 * supplies CIDR + ASN number + org name, never a type, so this collection
 * starts empty and every row an admin creates without an explicit reason
 * to do otherwise should record `asnType: "unclassified"` — never a
 * fabricated type. A later "AI research pass" (not built by this phase)
 * writes real classifications through `upsertClassification` below. This
 * is not a manual override list (the design plan's corrections section
 * rejected that) — it is the join key the fast-immediate branch's
 * ranges -> classification -> type-score chain uses (a later step wires
 * that chain; nothing here is called from `rapidAuthMutation` yet).
 */
export interface AsnClassificationDocument {
  _id: number;
  asnOrg?: string;
  asnType: AsnType;
  classificationSource: AsnClassificationSource;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

const COLLECTION_NAME = "botblockerAsnClassifications";

export async function ensureBotBlockerAsnClassificationIndexes(db: Db): Promise<void> {
  const collection = db.collection<AsnClassificationDocument>(COLLECTION_NAME);
  await Promise.all([
    collection.createIndex({ asnType: 1, updatedAt: -1 }),
  ]);
}

export function toAsnClassificationResponse(
  entry: AsnClassificationDocument,
): OperatorAsnClassificationEntry {
  return {
    asn: entry._id,
    asnType: entry.asnType,
    classificationSource: entry.classificationSource,
    ...(entry.asnOrg ? { asnOrg: entry.asnOrg } : {}),
    ...(entry.notes ? { notes: entry.notes } : {}),
    updatedBy: entry.updatedBy,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export class BotBlockerAsnClassificationPersistence {
  readonly #classifications: Collection<AsnClassificationDocument>;

  constructor(db: Db) {
    this.#classifications = db.collection<AsnClassificationDocument>(COLLECTION_NAME);
  }

  /**
   * Creates a classification row for an ASN, or overwrites an existing
   * one for the same ASN in place — matching the ip-blacklist upsert
   * pattern, since "one row per unique ASN" means this is naturally
   * idempotent rather than a duplicate-rejecting insert.
   */
  async upsertClassification(input: {
    asn: number;
    asnType: AsnType;
    classificationSource: AsnClassificationSource;
    asnOrg?: string;
    notes?: string;
    updatedBy: string;
    now: Date;
  }): Promise<AsnClassificationDocument> {
    const unset: Partial<Record<"asnOrg" | "notes", "">> = {};
    const set: Partial<AsnClassificationDocument> = {
      asnType: input.asnType,
      classificationSource: input.classificationSource,
      updatedBy: input.updatedBy,
      updatedAt: input.now,
    };
    if (input.asnOrg) set.asnOrg = input.asnOrg;
    else unset.asnOrg = "";
    if (input.notes) set.notes = input.notes;
    else unset.notes = "";

    const entry = await this.#classifications.findOneAndUpdate(
      { _id: input.asn },
      {
        $set: set,
        $unset: unset,
        $setOnInsert: { createdAt: input.now },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!entry) throw new Error("BotBlocker ASN classification upsert did not return a document");
    return entry;
  }

  /** Single-ASN lookup for the fast-immediate branch's ranges ->
   * classification -> type-score chain (Phase 16 step 7). Returns
   * `undefined` for an ASN with no classification row yet — the caller
   * treats that the same as an explicit `"unclassified"` row, matching
   * "every ASN defaulting to unclassified, never a fabricated type." */
  async findByAsn(asn: number): Promise<AsnClassificationDocument | undefined> {
    const entry = await this.#classifications.findOne({ _id: asn });
    return entry ?? undefined;
  }

  listClassifications(options: {
    asnType?: AsnType;
    limit: number;
    before?: Date;
  }): Promise<AsnClassificationDocument[]> {
    const filter: Filter<AsnClassificationDocument> = {
      ...(options.asnType ? { asnType: options.asnType } : {}),
      ...(options.before ? { updatedAt: { $lt: options.before } } : {}),
    };
    return this.#classifications
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(options.limit)
      .toArray();
  }
}
