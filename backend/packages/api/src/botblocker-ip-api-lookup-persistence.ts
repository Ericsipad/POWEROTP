import type { BotBlockerIpFamily } from "@powerotp/contracts";
import type { Collection, Db } from "mongodb";

import { ipFamily, normalizeIp } from "./ip-utils.js";
import { createId } from "./security.js";

/**
 * `botblockerIpApiLookupsV4`/`V6` (Phase 16 network-intelligence design,
 * execution step 6): the external vendor cache behind the
 * wait-for-full-result branch — only consulted when a resolved ASN type's
 * `requiresApiLookup` is `true` (`botblockerAsnTypeScores`, already
 * shipped). `vendor` is a plain configured label, not a hardcoded provider
 * name (see `ip-reputation-client.ts`) — the user mentioned one informally
 * as "ip.fino," likely a mishearing, so this stays generic/string-typed.
 * `rawResponse` is stored as-received (never re-shaped) so a later session
 * can add real score-merge logic without another schema change. Nothing
 * here is called from `rapidAuthMutation` yet — that wiring is a later
 * step; this module only builds the cache read/write path plus the
 * (currently unwired) awaited lookup in
 * `backend/packages/api/src/botblocker-ip-reputation-service.ts`.
 */
export interface IpApiLookupDocument {
  _id: string;
  ip: string;
  vendor: string;
  score: number;
  rawResponse: unknown;
  queriedAt: Date;
  expiresAt: Date;
}

const ID_PREFIXES = { v4: "ipl4", v6: "ipl6" } as const satisfies Record<
  BotBlockerIpFamily,
  string
>;

const COLLECTION_NAMES = {
  v4: "botblockerIpApiLookupsV4",
  v6: "botblockerIpApiLookupsV6",
} as const satisfies Record<BotBlockerIpFamily, string>;

/**
 * One placeholder row, seeded idempotently at startup per the user's
 * explicit instruction — a documented exception to "never mock data for
 * dev/prod" (see the Phase 16 plan's section 5) so the cache
 * read/write/score-merge path is exercised end-to-end before a real
 * vendor is chosen. Uses an RFC 5737 `TEST-NET-3` address, which can
 * never collide with a real visitor IP. `$setOnInsert`-only: if the TTL
 * index later expires and deletes this row, the next server boot
 * naturally reseeds it with a fresh `expiresAt`, the same idempotent,
 * safe-to-call-repeatedly convention `ProjectService#ensureDemoProject`
 * uses.
 */
const PLACEHOLDER_SEED = {
  ip: "203.0.113.10",
  vendor: "placeholder",
  score: 0,
  rawResponse: {
    note: "Seeded placeholder row; no live vendor integration configured yet.",
  },
} as const;
const PLACEHOLDER_SEED_TTL_MS = 24 * 60 * 60 * 1000;

export async function ensureBotBlockerIpApiLookupIndexes(db: Db): Promise<void> {
  await Promise.all(
    (Object.keys(COLLECTION_NAMES) as BotBlockerIpFamily[]).flatMap((family) => {
      const collection = db.collection<IpApiLookupDocument>(COLLECTION_NAMES[family]);
      return [
        collection.createIndex({ ip: 1 }, { unique: true }),
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ];
    }),
  );
  await seedPlaceholderEntry(db);
}

async function seedPlaceholderEntry(db: Db): Promise<void> {
  const now = new Date();
  await db.collection<IpApiLookupDocument>(COLLECTION_NAMES.v4).findOneAndUpdate(
    { ip: PLACEHOLDER_SEED.ip },
    {
      $setOnInsert: {
        _id: createId(ID_PREFIXES.v4),
        ip: PLACEHOLDER_SEED.ip,
        vendor: PLACEHOLDER_SEED.vendor,
        score: PLACEHOLDER_SEED.score,
        rawResponse: PLACEHOLDER_SEED.rawResponse,
        queriedAt: now,
        expiresAt: new Date(now.getTime() + PLACEHOLDER_SEED_TTL_MS),
      },
    },
    { upsert: true },
  );
}

export class BotBlockerIpApiLookupPersistence {
  readonly #v4: Collection<IpApiLookupDocument>;
  readonly #v6: Collection<IpApiLookupDocument>;

  constructor(db: Db) {
    this.#v4 = db.collection<IpApiLookupDocument>(COLLECTION_NAMES.v4);
    this.#v6 = db.collection<IpApiLookupDocument>(COLLECTION_NAMES.v6);
  }

  #collectionFor(family: BotBlockerIpFamily): Collection<IpApiLookupDocument> {
    return family === "v4" ? this.#v4 : this.#v6;
  }

  /**
   * The cache-check step the wait-for-full-result branch runs before ever
   * calling the live vendor API. Returns `undefined` for an invalid IP or
   * a cache miss — callers decide separately whether an entry found here
   * has already passed its `expiresAt` (kept as a plain field rather than
   * filtered out here, so a caller can distinguish "no row at all" from
   * "row present but expired" if that distinction ever matters).
   */
  async findByIp(ip: string): Promise<IpApiLookupDocument | undefined> {
    const normalized = normalizeIp(ip);
    const family = normalized ? ipFamily(normalized) : undefined;
    if (!normalized || !family) return undefined;
    const entry = await this.#collectionFor(family).findOne({ ip: normalized });
    return entry ?? undefined;
  }

  /**
   * Creates a new cache row, or refreshes an existing one for the same
   * raw IP in place — matching the ip-blacklist/network-range upsert
   * convention (one row per IP is naturally idempotent, not a
   * duplicate-rejecting insert).
   */
  async upsertEntry(input: {
    ip: string;
    vendor: string;
    score: number;
    rawResponse: unknown;
    queriedAt: Date;
    expiresAt: Date;
  }): Promise<IpApiLookupDocument> {
    const normalized = normalizeIp(input.ip);
    const family = normalized ? ipFamily(normalized) : undefined;
    if (!normalized || !family) {
      throw new Error("BotBlocker IP API lookup upsert requires a valid IPv4/IPv6 address");
    }

    const entry = await this.#collectionFor(family).findOneAndUpdate(
      { ip: normalized },
      {
        $set: {
          vendor: input.vendor,
          score: input.score,
          rawResponse: input.rawResponse,
          queriedAt: input.queriedAt,
          expiresAt: input.expiresAt,
        },
        $setOnInsert: {
          _id: createId(ID_PREFIXES[family]),
          ip: normalized,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!entry) throw new Error("BotBlocker IP API lookup upsert did not return a document");
    return entry;
  }
}
