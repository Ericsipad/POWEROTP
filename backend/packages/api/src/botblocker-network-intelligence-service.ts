import type { AsnType } from "@powerotp/contracts";

import type { BotBlockerAsnClassificationPersistence } from "./botblocker-asn-classification-persistence.js";
import type { BotBlockerAsnTypeScorePersistence } from "./botblocker-asn-type-score-persistence.js";
import type { BotBlockerIpBlacklistPersistence } from "./botblocker-ip-blacklist-persistence.js";
import type { BotBlockerIpReputationService } from "./botblocker-ip-reputation-service.js";
import type {
  GateSessionIpReputation,
  GateSessionNetworkClassification,
} from "./botblocker-intelligence-persistence.js";
import type { BotBlockerNetworkRangePersistence } from "./botblocker-network-range-persistence.js";

const UNCLASSIFIED_ASN_TYPE: AsnType = "unclassified";

export interface NetworkIntelligenceResolution {
  /** Set only on an active (not revoked, not expired) dedicated-blacklist
   * exact-IP match — per the Phase 16 plan, the only signal this phase
   * converts into a visitor-facing outcome (always `"otp"`). */
  blacklisted: boolean;
  networkClassification?: GateSessionNetworkClassification;
  ipReputation?: GateSessionIpReputation;
}

type BlacklistLookup = Pick<BotBlockerIpBlacklistPersistence, "findByIp">;
type RangeLookup = Pick<BotBlockerNetworkRangePersistence, "lookupByIp">;
type ClassificationLookup = Pick<BotBlockerAsnClassificationPersistence, "findByAsn">;
type TypeScoreLookup = Pick<BotBlockerAsnTypeScorePersistence, "listAllScores">;
type ReputationLookup = Pick<BotBlockerIpReputationService, "getReputation">;

/**
 * Composes the fast-immediate branch's two-step precedence for
 * `rapidAuthMutation` (Phase 16 network-intelligence design, execution step
 * 7 — see the plan's "Runtime integration" mermaid sequence diagram):
 *
 * 1. Dedicated IP-blacklist exact-match lookup. A hit short-circuits here —
 *    the network-range/ASN chain is never consulted for a blacklisted IP.
 * 2. On no blacklist match: network-range lookup -> ASN classification ->
 *    ASN type score, all synchronous/indexed/no network call. Only when the
 *    resolved type's `requiresApiLookup` is `true` does this await the
 *    external vendor lookup (already cache-checked internally by
 *    `BotBlockerIpReputationService`, itself never fire-and-forget).
 *
 * Per the plan's explicit exclusions, no final weighted/thresholded score
 * is computed here (Phase 17) — the network-range/ASN/vendor-score chain
 * is returned as informational session-level enrichment only; a blacklist
 * match is the only input this phase turns into a decision.
 */
export class BotBlockerNetworkIntelligenceService {
  constructor(
    private readonly blacklist: BlacklistLookup,
    private readonly networkRanges: RangeLookup,
    private readonly asnClassifications: ClassificationLookup,
    private readonly asnTypeScores: TypeScoreLookup,
    private readonly ipReputation: ReputationLookup,
  ) {}

  async resolve(
    ip: string | undefined,
    now: Date,
  ): Promise<NetworkIntelligenceResolution> {
    if (!ip) return { blacklisted: false };

    const blacklistEntry = await this.blacklist.findByIp(ip);
    if (blacklistEntry && isActiveBlacklistEntry(blacklistEntry, now)) {
      return { blacklisted: true };
    }

    const rangeMatch = await this.networkRanges.lookupByIp(ip);
    if (!rangeMatch) return { blacklisted: false };

    const classification = await this.asnClassifications.findByAsn(rangeMatch.asn);
    const asnType = classification?.asnType ?? UNCLASSIFIED_ASN_TYPE;
    const typeScores = await this.asnTypeScores.listAllScores();
    const typeScore = typeScores.find((entry) => entry.document._id === asnType)?.document;

    const networkClassification: GateSessionNetworkClassification = {
      asn: rangeMatch.asn,
      asnOrg: rangeMatch.asnOrg,
      asnType,
      score: typeScore?.score ?? 0,
      requiresApiLookup: typeScore?.requiresApiLookup ?? false,
    };

    if (!networkClassification.requiresApiLookup) {
      return { blacklisted: false, networkClassification };
    }

    const reputation = await this.ipReputation.getReputation(ip, now);
    return {
      blacklisted: false,
      networkClassification,
      ...(reputation
        ? { ipReputation: { vendor: reputation.vendor, score: reputation.score } }
        : {}),
    };
  }
}

function isActiveBlacklistEntry(
  entry: { revokedAt?: Date; expiresAt?: Date },
  now: Date,
): boolean {
  if (entry.revokedAt) return false;
  if (entry.expiresAt && entry.expiresAt <= now) return false;
  return true;
}
