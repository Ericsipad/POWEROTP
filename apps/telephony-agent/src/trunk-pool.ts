/**
 * Health-tracking, rotation, and failover across the flat pool of trunk
 * ids a node currently has (`NodeConfig.trunks[].id`, see
 * `apps/telephony-agent/src/pjsip-config.ts`). Any trunk can serve any
 * of the three voice verification types, so selection happens entirely
 * here, on the agent side — only the agent can see live SIP registration
 * behavior (via call outcomes), which is why trunk selection was moved
 * off the control plane. See the "Outbound trunk pool" section of
 * `docs/AS_BUILT.md` for the full design rationale.
 */

const FAILURE_THRESHOLD = 3;
const BASE_COOLDOWN_MS = 5 * 60_000;
const MAX_COOLDOWN_MS = 60 * 60_000;

/**
 * Reason codes that indicate a problem with the trunk/circuit itself
 * (registration lost, provider rejected the call outright at the
 * SIP/account level) as opposed to the destination declining or not
 * answering. Only these count toward a trunk's failure streak — a
 * `busy`/`no_answer`/`invalid_number` outcome proves the call actually
 * reached the network fine through that trunk and must never falsely
 * blacklist a healthy trunk just because one recipient didn't pick up.
 */
const providerLevelFailureReasons = new Set(["provider_unavailable", "call_rejected"]);

export function isProviderLevelFailure(reasonCode: string): boolean {
  return providerLevelFailureReasons.has(reasonCode);
}

interface TrunkHealth {
  consecutiveFailures: number;
  downUntil: number | undefined;
  cooldownMs: number;
  lastTriedAt: number;
}

function freshHealth(): TrunkHealth {
  return { consecutiveFailures: 0, downUntil: undefined, cooldownMs: BASE_COOLDOWN_MS, lastTriedAt: 0 };
}

export class TrunkPool {
  #trunkIds: string[];
  readonly #health = new Map<string, TrunkHealth>();

  constructor(trunkIds: readonly string[] = []) {
    this.#trunkIds = [...trunkIds];
  }

  /**
   * Called each time fresh `NodeConfig` is polled so trunks added or
   * removed in App Platform take effect without an agent restart. Health
   * state for ids that are no longer configured is dropped; ids that are
   * new start out healthy.
   */
  updateTrunkIds(trunkIds: readonly string[]): void {
    this.#trunkIds = [...trunkIds];
    for (const id of [...this.#health.keys()]) {
      if (!this.#trunkIds.includes(id)) this.#health.delete(id);
    }
  }

  /**
   * Currently-healthy trunk ids, in rotation order starting from the
   * least-recently-tried. With a single healthy trunk configured it
   * always wins (the intended behavior for today's real-world state of
   * exactly one working VoIP.ms subaccount).
   */
  pickHealthyTrunks(): string[] {
    const now = Date.now();
    return this.#trunkIds
      .filter((id) => !this.#isDown(id, now))
      .sort((a, b) => this.#lastTriedAt(a) - this.#lastTriedAt(b));
  }

  /**
   * Records the outcome of one call attempt on `trunkId`. A
   * provider-level failure increments the streak and, once it crosses
   * `FAILURE_THRESHOLD`, marks the trunk down for a cool-down window that
   * doubles on each subsequent failure (capped at `MAX_COOLDOWN_MS`). Any
   * other outcome (success, or a legitimate destination-side outcome
   * like busy/no_answer/invalid_number) resets the streak to 0 and the
   * cool-down window back to its base — the trunk itself is proven fine.
   */
  reportOutcome(trunkId: string, reasonCode: string): void {
    const health = this.#health.get(trunkId) ?? freshHealth();
    health.lastTriedAt = Date.now();

    if (isProviderLevelFailure(reasonCode)) {
      health.consecutiveFailures += 1;
      if (health.consecutiveFailures >= FAILURE_THRESHOLD) {
        health.downUntil = Date.now() + health.cooldownMs;
        health.cooldownMs = Math.min(health.cooldownMs * 2, MAX_COOLDOWN_MS);
      }
    } else {
      health.consecutiveFailures = 0;
      health.downUntil = undefined;
      health.cooldownMs = BASE_COOLDOWN_MS;
    }

    this.#health.set(trunkId, health);
  }

  #isDown(id: string, now: number): boolean {
    const downUntil = this.#health.get(id)?.downUntil;
    return downUntil !== undefined && downUntil > now;
  }

  #lastTriedAt(id: string): number {
    return this.#health.get(id)?.lastTriedAt ?? 0;
  }

  /**
   * Read-only view of every currently-configured trunk's call-outcome
   * health, for reporting to the control plane (see `docs/AS_BUILT.md`'s
   * "Admin operator health dashboard" section) — never used for rotation
   * itself, and never mutates `#health`. A trunk with no recorded outcome
   * yet (never tried since the last config poll) reports healthy with zero
   * failures, matching `pickHealthyTrunks()`'s own default.
   */
  snapshot(): TrunkHealthSnapshot[] {
    const now = Date.now();
    return this.#trunkIds.map((id) => {
      const health = this.#health.get(id);
      return {
        id,
        healthy: !this.#isDown(id, now),
        consecutiveFailures: health?.consecutiveFailures ?? 0,
        downUntil: health?.downUntil,
      };
    });
  }
}

export interface TrunkHealthSnapshot {
  id: string;
  healthy: boolean;
  consecutiveFailures: number;
  downUntil: number | undefined;
}
