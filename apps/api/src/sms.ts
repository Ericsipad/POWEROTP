import type { ProductionConfig } from "./config.js";
import { allTrunkDids } from "./outbound-trunks.js";

const VOIPMS_API_URL = "https://voip.ms/api/v1/rest.php";

type SmsConfig = Pick<
  ProductionConfig,
  | "VOIPMS_SMS_API_USERNAME" | "VOIPMS_SMS_API_PASSWORD"
  | "TRUNK1_DID" | "TRUNK2_DID" | "TRUNK3_DID" | "TRUNK4_DID" | "TRUNK5_DID" | "TRUNK6_DID"
>;

export interface SmsService {
  sendVerificationCode(targetNumber: string, code: string): Promise<void>;
}

export class SmsProviderError extends Error {
  constructor(readonly reasonCode: "provider_rejected" | "provider_unavailable") {
    super(reasonCode);
  }
}

/**
 * VoIP.ms accepts REST parameters through POST form data. Keeping the API
 * password in the request body instead of the query string prevents it
 * from appearing in URLs, access logs, or thrown fetch errors.
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
          return;
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
  let response: Response;
  try {
    response = await fetchImpl(VOIPMS_API_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        api_username: username,
        api_password: password,
        method: "sendSMS",
        did,
        dst: targetNumber,
        message: `Your POWEROTP verification code is ${code}.`,
        format: "json",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SmsProviderError("provider_unavailable");
  }

  if (!response.ok) throw new SmsProviderError("provider_unavailable");

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new SmsProviderError("provider_unavailable");
  }
  if (!isSuccessfulResponse(result)) {
    throw new SmsProviderError("provider_rejected");
  }
}

function isSuccessfulResponse(value: unknown): value is { status: "success"; sms: string | number } {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return (
    response.status === "success" &&
    (typeof response.sms === "string" || typeof response.sms === "number")
  );
}
