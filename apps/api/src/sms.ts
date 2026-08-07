import type { ProductionConfig } from "./config.js";

const VOIPMS_API_URL = "https://voip.ms/api/v1/rest.php";

type SmsConfig = Pick<
  ProductionConfig,
  "VOIPMS_SMS_API_USERNAME" | "VOIPMS_SMS_API_PASSWORD" | "VOIPMS_SMS_DID"
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
 */
export function createVoipMsSmsService(
  config: SmsConfig,
  fetchImpl: typeof fetch = fetch,
): SmsService | undefined {
  const username = config.VOIPMS_SMS_API_USERNAME;
  const password = config.VOIPMS_SMS_API_PASSWORD;
  const did = config.VOIPMS_SMS_DID;
  if (!username || !password || !did) return undefined;

  return {
    async sendVerificationCode(targetNumber, code) {
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
    },
  };
}

function isSuccessfulResponse(value: unknown): value is { status: "success"; sms: string | number } {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return (
    response.status === "success" &&
    (typeof response.sms === "string" || typeof response.sms === "number")
  );
}
