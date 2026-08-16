import type { ProductionConfig } from "./config.js";
import { allTrunkDids } from "./outbound-trunks.js";
import { postVoipMsApi } from "./voipms-http.js";

type SmsConfig = Pick<
  ProductionConfig,
  | "VOIPMS_SMS_API_USERNAME" | "VOIPMS_SMS_API_PASSWORD"
  | "TRUNK1_DID" | "TRUNK2_DID" | "TRUNK3_DID" | "TRUNK4_DID" | "TRUNK5_DID" | "TRUNK6_DID"
>;

export interface SmsSendResult {
  /** Which `TRUNKn_DID` actually sent this message — recorded on the
   * interaction (see `backend/packages/api/src/transport.ts`) so a later billing
   * reconciliation pass knows which DID to query VoIP.ms's `getSMS`
   * records for. */
  did: string;
}

export interface SmsService {
  sendVerificationCode(targetNumber: string, code: string): Promise<SmsSendResult>;
}

export class SmsProviderError extends Error {
  constructor(readonly reasonCode: "provider_rejected" | "provider_unavailable") {
    super(reasonCode);
  }
}

/**
 * VoIP.ms accepts REST parameters through POST form data — specifically
 * `multipart/form-data`, not `application/x-www-form-urlencoded`.
 * Live-confirmed: sending the same parameters as a URL-encoded body gets
 * misrouted into VoIP.ms's SOAP handler and returns a `500` SOAP fault
 * (`env:Sender`/"Bad Request"), even though the parameters and
 * credentials are otherwise fine — `multipart/form-data` is the only POST
 * shape their REST endpoint actually accepts (a GET with query params
 * also works, but would put the API password in the URL/access logs,
 * which is exactly what POST is meant to avoid here). Using `FormData` as
 * the body lets `fetch` set the correct `multipart/form-data; boundary=`
 * header itself — do not set `content-type` manually here.
 *
 * The sending DID is not a single hardcoded number: `sendSMS` still
 * requires exactly one origin DID per call (every SMS needs a single
 * "from" number, same as everywhere else), but any `TRUNKn_DID` you have
 * configured is usable — this rotates round-robin across all of them
 * (starting from whichever was least recently used) instead of pinning
 * every send to one number, and falls over to the next configured DID if
 * a send is rejected for a provider-level reason, so one problem DID
 * can't block `sms_code` entirely. Deliberately no persistent health/
 * cool-down tracking like `apps/telephony-agent/src/trunk-pool.ts` — SMS
 * DIDs don't fail the way SIP trunk registrations do, so a simple retry
 * across the pool per send is enough.
 */
export function createVoipMsSmsService(
  config: SmsConfig,
  fetchImpl: typeof fetch = fetch,
): SmsService | undefined {
  const username = config.VOIPMS_SMS_API_USERNAME;
  const password = config.VOIPMS_SMS_API_PASSWORD;
  const dids = allTrunkDids(config);
  if (!username || !password || dids.length === 0) return undefined;

  let nextDidIndex = 0;

  return {
    async sendVerificationCode(targetNumber, code) {
      let lastError: SmsProviderError = new SmsProviderError("provider_unavailable");

      for (let attempt = 0; attempt < dids.length; attempt += 1) {
        const did = dids[nextDidIndex % dids.length]!;
        nextDidIndex += 1;

        try {
          await sendOnce(fetchImpl, username, password, did, targetNumber, code);
          return { did };
        } catch (error) {
          lastError = error instanceof SmsProviderError ? error : new SmsProviderError("provider_unavailable");
        }
      }

      throw lastError;
    },
  };
}

async function sendOnce(
  fetchImpl: typeof fetch,
  username: string,
  password: string,
  did: string,
  targetNumber: string,
  code: string,
): Promise<void> {
  const result = await postVoipMsApi(
    {
      api_username: username,
      api_password: password,
      method: "sendSMS",
      did,
      dst: targetNumber,
      message: `Your POWEROTP verification code is ${code}.`,
      format: "json",
    },
    fetchImpl,
  );

  if (!result.ok) {
    // Logged (truncated, no headers, never credentials) so any future
    // non-2xx (a real outage, a request-shape regression, VoIP.ms API
    // changes, etc.) is diagnosable from App Platform's own log viewer
    // without needing to reproduce it from another network.
    switch (result.failure.kind) {
      case "network":
        logSmsFailure("fetch threw before a response was received", { error: result.failure.error });
        break;
      case "http":
        logSmsFailure("VoIP.ms returned a non-2xx response", {
          status: result.failure.status,
          bodyPreview: result.failure.bodyPreview,
        });
        break;
      case "bad_json":
        logSmsFailure("VoIP.ms's response body was not valid JSON (possible WAF/challenge page)", {
          status: result.failure.status,
          contentType: result.failure.contentType,
        });
        break;
    }
    throw new SmsProviderError("provider_unavailable");
  }

  if (!isSuccessfulResponse(result.body)) {
    logSmsFailure("VoIP.ms rejected the request", { result: result.body });
    throw new SmsProviderError("provider_rejected");
  }
}

function logSmsFailure(msg: string, extra: Record<string, unknown>) {
  console.error(JSON.stringify({ service: "powerotp-api", component: "sms", msg, ...extra }));
}

function isSuccessfulResponse(value: unknown): value is { status: "success"; sms: string | number } {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return (
    response.status === "success" &&
    (typeof response.sms === "string" || typeof response.sms === "number")
  );
}
