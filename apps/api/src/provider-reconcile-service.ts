import type { ProductionConfig } from "./config.js";
import { allOutboundTrunks } from "./outbound-trunks.js";
import type { ProviderRecordSnapshot, VerificationRequestDocument } from "./verification-persistence.js";
import {
  digitsOnly,
  fetchVoipMsCdr,
  fetchVoipMsSms,
  numbersLikelyMatch,
  reconciliationWindow,
} from "./voipms-billing-client.js";

/**
 * VoIP.ms's own flat, publicly documented outbound SMS rate (see
 * `wiki.voip.ms/article/SMS-MMS`: "$0.0075 per incoming and outgoing
 * message"). `getSMS` does not return a per-message cost field the way
 * `getCDR` returns a per-call `total`, so this is a constant, not
 * something pulled from the API response — update it here if VoIP.ms ever
 * changes the published rate.
 */
export const SMS_OUTBOUND_RATE_USD = 0.0075;

export type ReconcileOutcome =
  | { status: "matched"; record: ProviderRecordSnapshot }
  | { status: "not_found" };

type ReconcileConfig = ProductionConfig;

/**
 * VoIP.ms's real, confirmed `getCDR` response row shape — taken directly
 * from VoIP.ms's own official API documentation
 * (https://voip.ms/m/apidocs.php), captured verbatim (including real
 * example values, e.g. `destination: "5551234567"`, `total: "0.00000000"`)
 * in the open-source `ecliptical/voip-ms` Rust client's
 * `tools/api-responses.json` and mirrored in its published
 * `GetCDRResponseCDR` struct
 * (https://docs.rs/voip-ms/latest/voip_ms/struct.GetCDRResponseCDR.html).
 * Every field VoIP.ms documents is typed here even though only a few are
 * used below, so the full shape is visible at the type level, not just in
 * a comment. All scalar types arrive on the wire as strings except where
 * VoIP.ms's own schema says otherwise.
 */
interface VoipMsCdrRow {
  date: string;
  callerid: string;
  destination: string;
  description: string;
  account: string;
  disposition: string;
  duration: string;
  seconds: number;
  rate: string;
  total: string;
  uniqueid: number;
  destination_type: string;
  call_logs: string;
}

/**
 * VoIP.ms's real, confirmed `getSMS` response row shape — same source as
 * `VoipMsCdrRow` above: VoIP.ms's official API docs
 * (https://voip.ms/m/apidocs.php), captured in `ecliptical/voip-ms`'s
 * `tools/api-responses.json` and its `GetSMSResponseSMS`/`MessageType`
 * types (https://docs.rs/voip-ms/latest/voip_ms/struct.GetSMSResponseSMS.html).
 * `type` is documented by VoIP.ms itself as "Boolean: 1 = received / 0 =
 * sent". VoIP.ms does not return a per-message cost field here at all —
 * see `SMS_OUTBOUND_RATE_USD` above.
 */
interface VoipMsSmsRow {
  id: number;
  date: string;
  type: "0" | "1";
  did: string;
  contact: string;
  message: string;
  carrier_status: string;
}

/**
 * Finds the real VoIP.ms `getCDR` row for one voice interaction (any of
 * `call_reachability`/`voice_code`/`voice_challenge`) and extracts its
 * duration/cost.
 */
export async function reconcileVoiceInteraction(
  config: ReconcileConfig,
  verification: Pick<VerificationRequestDocument, "targetNumber" | "createdAt" | "callTrunkId">,
  fetchImpl?: typeof fetch,
): Promise<ReconcileOutcome> {
  if (!verification.callTrunkId) return { status: "not_found" };

  const trunk = allOutboundTrunks(config).find((candidate) => candidate.id === verification.callTrunkId);
  const window = reconciliationWindow(verification.createdAt);
  const rows = (await fetchVoipMsCdr(config, window, fetchImpl)) as unknown as VoipMsCdrRow[];

  const candidates = rows.filter((row) => {
    if (!numbersLikelyMatch(row.destination, verification.targetNumber)) return false;
    // Only narrow by account when we can still resolve the trunk's own
    // subaccount name (it could have been removed from the pool since) —
    // never reject a real match just because that lookup came up empty.
    if (trunk && row.account && digitsOnlyOrRaw(row.account) !== digitsOnlyOrRaw(trunk.user)) {
      return false;
    }
    return true;
  });

  const best = closestByTime(candidates, verification.createdAt, (row) => row.date);
  if (!best) return { status: "not_found" };

  return {
    status: "matched",
    record: {
      source: "voipms_cdr",
      fetchedAt: new Date(),
      durationSeconds: toNumber(best.seconds),
      providerCostUsd: toNumber(best.total),
      raw: best as unknown as Record<string, unknown>,
    },
  };
}

/** Finds the real VoIP.ms `getSMS` row for one `sms_code` interaction. */
export async function reconcileSmsInteraction(
  config: ReconcileConfig,
  verification: Pick<VerificationRequestDocument, "targetNumber" | "createdAt" | "smsDid">,
  fetchImpl?: typeof fetch,
): Promise<ReconcileOutcome> {
  if (!verification.smsDid) return { status: "not_found" };

  const window = reconciliationWindow(verification.createdAt);
  const rows = (await fetchVoipMsSms(config, verification.smsDid, window, fetchImpl)) as unknown as VoipMsSmsRow[];

  const candidates = rows.filter(
    (row) => String(row.type) === "0" && numbersLikelyMatch(row.contact, verification.targetNumber),
  );

  const best = closestByTime(candidates, verification.createdAt, (row) => row.date);
  if (!best) return { status: "not_found" };

  return {
    status: "matched",
    record: {
      source: "voipms_sms",
      fetchedAt: new Date(),
      providerCostUsd: SMS_OUTBOUND_RATE_USD,
      raw: best as unknown as Record<string, unknown>,
    },
  };
}

function digitsOnlyOrRaw(value: string): string {
  const digits = digitsOnly(value);
  return digits.length > 0 ? digits : value;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** Picks whichever candidate row's own timestamp (VoIP.ms's `date` field,
 * `"YYYY-MM-DD HH:MM:SS"`) is closest to when the interaction was created
 * — the only reliable disambiguator when more than one call/SMS to the
 * same number happened close together. */
function closestByTime<T>(rows: T[], target: Date, dateOf: (row: T) => string): T | undefined {
  let best: { row: T; diffMs: number } | undefined;
  for (const row of rows) {
    const raw = dateOf(row);
    if (!raw) continue;
    const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    if (Number.isNaN(parsed.getTime())) continue;
    const diffMs = Math.abs(parsed.getTime() - target.getTime());
    if (!best || diffMs < best.diffMs) best = { row, diffMs };
  }
  return best?.row;
}
