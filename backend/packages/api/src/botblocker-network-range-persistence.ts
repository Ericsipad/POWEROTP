import type { Collection, Db } from "mongodb";

import { encodeIpForRangeLookup } from "./ip-utils.js";

/**
 * `botblockerNetworkRangesV4`/`V6` (Phase 16 network-intelligence design,
 * execution step 3): flat, non-overlapping CIDR-range partitions loaded
 * directly from a MaxMind GeoLite2-ASN CSV export. Per the plan's item 9
 * correction there is no repository-owned import pipeline — the user
 * loads each CSV into MongoDB manually (e.g. `mongoimport`, or a
 * Cursor-assisted one-off load) to match this shape. This module defines
 * that shape/indexes plus the synchronous indexed range lookup used by
 * the canonical first-report network-intelligence branch.
 *
 * Physically separate per address family (not one collection with a
 * `family` filter) so a v4 lookup never touches v6 storage/index/working
 * set, and vice versa, and so each MaxMind CSV (already shipped as two
 * separate files) can be reloaded independently.
 */
export interface NetworkRangeV4Document {
  _id: string;
  rangeStart: number;
  rangeEnd: number;
  cidr: string;
  prefixLength: number;
  asn: number;
  asnOrg: string;
  sourceDataset: string;
  importBatchId: string;
  importedAt: Date;
}

/**
 * Same shape as the v4 document, but keyed by `rangeStartHex`/
 * `rangeEndHex` — a fixed-width 32-character zero-padded lowercase hex
 * string (see `ip-utils.ts#ipv6ToFixedWidthHex`) instead of a plain
 * integer, since a 128-bit value doesn't fit safely in a JS/BSON number
 * and `Decimal128` can't hold the full IPv6 range exactly.
 */
export interface NetworkRangeV6Document {
  _id: string;
  rangeStartHex: string;
  rangeEndHex: string;
  cidr: string;
  prefixLength: number;
  asn: number;
  asnOrg: string;
  sourceDataset: string;
  importBatchId: string;
  importedAt: Date;
}

const COLLECTION_NAMES = {
  v4: "botblockerNetworkRangesV4",
  v6: "botblockerNetworkRangesV6",
} as const;

export async function ensureBotBlockerNetworkRangeIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection<NetworkRangeV4Document>(COLLECTION_NAMES.v4).createIndex({ rangeStart: 1 }),
    db.collection<NetworkRangeV6Document>(COLLECTION_NAMES.v6).createIndex({ rangeStartHex: 1 }),
  ]);
}

export interface NetworkRangeMatch {
  asn: number;
  asnOrg: string;
  cidr: string;
  prefixLength: number;
}

export class BotBlockerNetworkRangePersistence {
  readonly #v4: Collection<NetworkRangeV4Document>;
  readonly #v6: Collection<NetworkRangeV6Document>;

  constructor(db: Db) {
    this.#v4 = db.collection<NetworkRangeV4Document>(COLLECTION_NAMES.v4);
    this.#v6 = db.collection<NetworkRangeV6Document>(COLLECTION_NAMES.v6);
  }

  /**
   * Synchronous (no network call), indexed range lookup: finds the flat
   * non-overlapping partition whose start/end bracket the given IP, using
   * the same "greatest start <= ip, confirm ip <= end" technique
   * MaxMind/IPinfo's own flat-file products use — O(log n) via the single
   * B-tree index per collection created above. Returns `undefined` for an
   * invalid IP, or one outside every manually-loaded range (never
   * fabricates a match). Unused by any route in this session; a later
   * step calls this from the fast-immediate branch.
   */
  async lookupByIp(ip: string): Promise<NetworkRangeMatch | undefined> {
    const encoded = encodeIpForRangeLookup(ip);
    if (!encoded) return undefined;

    if (encoded.family === "v4") {
      const candidate = await this.#v4.findOne(
        { rangeStart: { $lte: encoded.value } },
        { sort: { rangeStart: -1 } },
      );
      if (!candidate || encoded.value > candidate.rangeEnd) return undefined;
      return toMatch(candidate);
    }

    const candidate = await this.#v6.findOne(
      { rangeStartHex: { $lte: encoded.value } },
      { sort: { rangeStartHex: -1 } },
    );
    if (!candidate || encoded.value > candidate.rangeEndHex) return undefined;
    return toMatch(candidate);
  }
}

function toMatch(document: NetworkRangeV4Document | NetworkRangeV6Document): NetworkRangeMatch {
  return {
    asn: document.asn,
    asnOrg: document.asnOrg,
    cidr: document.cidr,
    prefixLength: document.prefixLength,
  };
}
