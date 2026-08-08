import type { ProductionConfig } from "./config.js";
import { postVoipMsApi } from "./voipms-http.js";

type BillingCredentialsConfig = Pick<
  ProductionConfig,
  "VOIPMS_SMS_API_USERNAME" | "VOIPMS_SMS_API_PASSWORD"
>;

export class VoipMsBillingError extends Error {
  constructor(readonly reasonCode: "not_configured" | "provider_rejected" | "provider_unavailable") {
    super(reasonCode);
  }
}

function credentialsOrThrow(config: BillingCredentialsConfig) {
  const username = config.VOIPMS_SMS_API_USERNAME;
  const password = config.VOIPMS_SMS_API_PASSWORD;
  if (!username || !password) throw new VoipMsBillingError("not_configured");
  return { username, password };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `getCDR`/`getSMS` only filter by whole calendar date (VoIP.ms's own docs
 * give examples like `"2010-11-30"`, no time component) — reconciliation
 * always widens the window by a day on each side of the interaction's
 * `createdAt` so a call/SMS placed close to UTC midnight is never missed,
 * and matches the exact record within that window by destination number
 * and closeness in time instead.
 */
export function reconciliationWindow(createdAt: Date): { dateFrom: string; dateTo: string } {
  const from = new Date(createdAt);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(createdAt);
  to.setUTCDate(to.getUTCDate() + 1);
  return { dateFrom: isoDate(from), dateTo: isoDate(to) };
}

/** Keeps only the trailing digits of a phone number for comparison against
 * VoIP.ms's CDR/SMS records, which report destinations/contacts without a
 * leading `+` and sometimes without the country code — comparing suffixes
 * avoids false negatives from formatting differences alone. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function numbersLikelyMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  return da.endsWith(db) || db.endsWith(da);
}

/**
 * Raw call detail records for every call across the whole VoIP.ms account
 * in the given date window (VoIP.ms's `getCDR` method) — every field is
 * VoIP.ms's own, unmodified. See
 * `apps/api/src/provider-reconcile-service.ts#VoipMsCdrRow` for the
 * confirmed, real field names (sourced from VoIP.ms's own API docs, not
 * guessed) and how they're extracted.
 */
export async function fetchVoipMsCdr(
  config: BillingCredentialsConfig,
  window: { dateFrom: string; dateTo: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const { username, password } = credentialsOrThrow(config);
  const result = await postVoipMsApi(
    {
      api_username: username,
      api_password: password,
      method: "getCDR",
      date_from: window.dateFrom,
      date_to: window.dateTo,
      timezone: "0",
      answered: "1",
      noanswer: "1",
      busy: "1",
      failed: "1",
      format: "json",
    },
    fetchImpl,
  );
  return extractRows(result, "cdr");
}

/**
 * Raw SMS records for one DID in the given date window (VoIP.ms's `getSMS`
 * method). Unlike `getCDR`, VoIP.ms does not expose a per-message cost
 * field here — SMS is billed at a flat, publicly documented rate (see
 * `SMS_OUTBOUND_RATE_USD` in `provider-reconcile-service.ts`), so this is
 * purely for confirming the message was actually sent and recording its
 * VoIP.ms message id/timestamp, not for a per-message cost lookup.
 */
export async function fetchVoipMsSms(
  config: BillingCredentialsConfig,
  did: string,
  window: { dateFrom: string; dateTo: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const { username, password } = credentialsOrThrow(config);
  const result = await postVoipMsApi(
    {
      api_username: username,
      api_password: password,
      method: "getSMS",
      did,
      from: window.dateFrom,
      to: window.dateTo,
      format: "json",
    },
    fetchImpl,
  );
  return extractRows(result, "sms");
}

function extractRows(
  result: Awaited<ReturnType<typeof postVoipMsApi>>,
  field: "cdr" | "sms",
): Record<string, unknown>[] {
  if (!result.ok) {
    throw new VoipMsBillingError(
      result.failure.kind === "http" || result.failure.kind === "bad_json"
        ? "provider_rejected"
        : "provider_unavailable",
    );
  }
  const body = result.body;
  if (!body || typeof body !== "object") throw new VoipMsBillingError("provider_unavailable");
  const record = body as Record<string, unknown>;
  if (record.status !== "success") {
    // A day with zero calls/messages still reports "no_cdr"/"no_sms" as
    // `status`, not `"success"` with an empty array — treated as "nothing
    // to reconcile yet", not a hard failure, so the reconcile worker's
    // retry/backoff can just try again once VoIP.ms actually has the row.
    return [];
  }
  const rows = record[field];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}
