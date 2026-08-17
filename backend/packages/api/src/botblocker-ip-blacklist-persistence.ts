import type {
  BotBlockerIpFamily,
  IpBlacklistProvenance,
  OperatorIpBlacklistEntry,
} from "@powerotp/contracts";
import type { Collection, Db, Filter } from "mongodb";

import { ipFamily, normalizeIp } from "./ip-utils.js";
import { createId } from "./security.js";

/**
 * `botblockerIpBlacklistV4`/`V6` (Phase 16 network-intelligence design): a
 * small, dedicated, exact-IP-match table per address family, checked
 * before the ASN/subnet range lookup so a known-bad IP short-circuits to
 * `otp` without touching the larger network-classification tables. This is
 * the only admin-facing BotBlocker override; there is no separate generic
 * allow/blacklist mechanism.
 */
export interface IpBlacklistDocument {
  _id: string;
  ip: string;
  reason: string;
  provenance: IpBlacklistProvenance;
  expiresAt?: Date;
  revokedAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const FAMILY_ID_PREFIXES = { v4: "bl4", v6: "bl6" } as const satisfies Record<
  BotBlockerIpFamily,
  string
>;

const COLLECTION_NAMES = {
  v4: "botblockerIpBlacklistV4",
  v6: "botblockerIpBlacklistV6",
} as const satisfies Record<BotBlockerIpFamily, string>;

/** Every blacklist entry ID is prefixed by its family so a caller holding
 * only an `entryId` (e.g. a revoke request) can address the correct
 * physical collection without an extra round trip or request parameter. */
export function identifyBlacklistEntryFamily(
  entryId: string,
): BotBlockerIpFamily | undefined {
  if (entryId.startsWith(`${FAMILY_ID_PREFIXES.v4}_`)) return "v4";
  if (entryId.startsWith(`${FAMILY_ID_PREFIXES.v6}_`)) return "v6";
  return undefined;
}

/** Shared document-to-API-response mapping used by both the list/create and
 * revoke control routes so they cannot drift from each other. */
export function toIpBlacklistEntryResponse(
  entry: IpBlacklistDocument,
  family: BotBlockerIpFamily,
): OperatorIpBlacklistEntry {
  return {
    entryId: entry._id,
    family,
    ip: entry.ip,
    reason: entry.reason,
    provenance: entry.provenance,
    ...(entry.expiresAt ? { expiresAt: entry.expiresAt.toISOString() } : {}),
    ...(entry.revokedAt ? { revokedAt: entry.revokedAt.toISOString() } : {}),
    createdBy: entry.createdBy,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export class IpBlacklistValidationError extends Error {
  constructor(readonly code: "invalid_ip") {
    super(code);
    this.name = "IpBlacklistValidationError";
  }
}

export async function ensureBotBlockerIpBlacklistIndexes(db: Db): Promise<void> {
  await Promise.all(
    (Object.keys(COLLECTION_NAMES) as BotBlockerIpFamily[]).flatMap((family) => {
      const collection = db.collection<IpBlacklistDocument>(
        COLLECTION_NAMES[family],
      );
      return [
        collection.createIndex({ ip: 1 }, { unique: true }),
        collection.createIndex({ createdAt: -1 }),
      ];
    }),
  );
}

export class BotBlockerIpBlacklistPersistence {
  readonly #v4: Collection<IpBlacklistDocument>;
  readonly #v6: Collection<IpBlacklistDocument>;

  constructor(db: Db) {
    this.#v4 = db.collection<IpBlacklistDocument>(COLLECTION_NAMES.v4);
    this.#v6 = db.collection<IpBlacklistDocument>(COLLECTION_NAMES.v6);
  }

  #collectionFor(family: BotBlockerIpFamily): Collection<IpBlacklistDocument> {
    return family === "v4" ? this.#v4 : this.#v6;
  }

  /**
   * Creates a new blacklist entry, or refreshes an existing one for the
   * same raw IP in place (reason/provenance/expiry overwrite, any prior
   * revocation clears) — see `OperatorIpBlacklistMutationSchema`'s doc
   * comment for why this is an upsert rather than a duplicate-rejecting
   * insert.
   */
  async upsertEntry(input: {
    ip: string;
    reason: string;
    provenance: IpBlacklistProvenance;
    expiresAt?: Date;
    createdBy: string;
    now: Date;
  }): Promise<IpBlacklistDocument> {
    const normalized = normalizeIp(input.ip);
    const family = normalized ? ipFamily(normalized) : undefined;
    if (!normalized || !family) throw new IpBlacklistValidationError("invalid_ip");

    const unset: Partial<Record<"expiresAt" | "revokedAt", "">> = {
      revokedAt: "",
    };
    const set: Partial<IpBlacklistDocument> = {
      reason: input.reason,
      provenance: input.provenance,
      updatedAt: input.now,
    };
    if (input.expiresAt) set.expiresAt = input.expiresAt;
    else unset.expiresAt = "";

    const entry = await this.#collectionFor(family).findOneAndUpdate(
      { ip: normalized },
      {
        $set: set,
        $unset: unset,
        $setOnInsert: {
          _id: createId(FAMILY_ID_PREFIXES[family]),
          createdBy: input.createdBy,
          createdAt: input.now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!entry) throw new Error("BotBlocker IP blacklist upsert did not return a document");
    return entry;
  }

  async revokeEntry(entryId: string, now: Date): Promise<IpBlacklistDocument | undefined> {
    const family = identifyBlacklistEntryFamily(entryId);
    if (!family) return undefined;
    const entry = await this.#collectionFor(family).findOneAndUpdate(
      { _id: entryId },
      { $set: { revokedAt: now, updatedAt: now } },
      { returnDocument: "after" },
    );
    return entry ?? undefined;
  }

  async findByIp(ip: string): Promise<IpBlacklistDocument | undefined> {
    const normalized = normalizeIp(ip);
    const family = normalized ? ipFamily(normalized) : undefined;
    if (!normalized || !family) return undefined;
    const entry = await this.#collectionFor(family).findOne({ ip: normalized });
    return entry ?? undefined;
  }

  listEntries(
    family: BotBlockerIpFamily,
    options: { limit: number; before?: Date },
  ): Promise<IpBlacklistDocument[]> {
    const filter: Filter<IpBlacklistDocument> = options.before
      ? { createdAt: { $lt: options.before } }
      : {};
    return this.#collectionFor(family)
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(options.limit)
      .toArray();
  }
}
