import type { BotBlockerIpApiLookupPersistence } from "./botblocker-ip-api-lookup-persistence.js";
import { createIpReputationVendorClient, type IpReputationVendorClient } from "./ip-reputation-client.js";
import { ipFamily, normalizeIp } from "./ip-utils.js";

import type { ProductionConfig } from "./config.js";

export interface IpReputationResult {
  vendor: string;
  score: number;
  rawResponse: unknown;
}

type IpReputationServiceConfig = Pick<
  ProductionConfig,
  | "BOTBLOCKER_IP_REPUTATION_VENDOR_NAME"
  | "BOTBLOCKER_IP_REPUTATION_VENDOR_URL"
  | "BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY"
>;

/** How long a freshly-fetched vendor result is trusted before the next
 * lookup for the same IP re-queries the vendor instead of reusing the
 * cache row. Not user-configurable (unlike the vendor credentials
 * themselves) — this is caching policy, not an integration secret. */
const FRESH_LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Owns the wait-for-full-result branch's external vendor lookup
 * (Phase 16 network-intelligence design, plan correction 6): checks
 * `botblockerIpApiLookupsV4`/`V6` by IP first, only calling the live
 * vendor API on a cache miss or expiry, and persisting a fresh cache row
 * on a successful call. `getReputation` is always awaited end-to-end by
 * its caller — never fire-and-forget, per the plan's correction. Resolves
 * to `undefined` (never throws, never blocks indefinitely) when: the IP
 * is invalid, no vendor is configured
 * (`BOTBLOCKER_IP_REPUTATION_VENDOR_*` unset), or the vendor call itself
 * fails — so a not-yet-credentialed or momentarily-unavailable vendor
 * never stalls or breaks the response the future `rapidAuthMutation`
 * wiring (step 7, not this session) builds around this. Not called from
 * any route in this session.
 */
export class BotBlockerIpReputationService {
  readonly #vendor: IpReputationVendorClient | undefined;

  constructor(
    private readonly cache: BotBlockerIpApiLookupPersistence,
    vendorConfig: IpReputationServiceConfig,
  ) {
    this.#vendor = createIpReputationVendorClient(vendorConfig);
  }

  async getReputation(ip: string, now: Date = new Date()): Promise<IpReputationResult | undefined> {
    const normalized = normalizeIp(ip);
    if (!normalized || !ipFamily(normalized)) return undefined;

    const cached = await this.cache.findByIp(normalized);
    if (cached && cached.expiresAt > now) {
      return { vendor: cached.vendor, score: cached.score, rawResponse: cached.rawResponse };
    }

    if (!this.#vendor) return undefined;

    let result;
    try {
      result = await this.#vendor.lookup(normalized);
    } catch {
      return undefined;
    }

    await this.cache.upsertEntry({
      ip: normalized,
      vendor: this.#vendor.vendorName,
      score: result.score,
      rawResponse: result.rawResponse,
      queriedAt: now,
      expiresAt: new Date(now.getTime() + FRESH_LOOKUP_TTL_MS),
    });

    return { vendor: this.#vendor.vendorName, score: result.score, rawResponse: result.rawResponse };
  }
}
