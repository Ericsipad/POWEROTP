import { assertPublicHttpsUrl } from "./callback-ssrf-guard.js";
import { signCallbackBody } from "./callback-signing.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const MAX_REDIRECTS = 1;

export interface CallbackDeliveryResult {
  delivered: boolean;
  statusCode?: number;
  error?: string;
}

async function readLimitedBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  let received = 0;
  while (received < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read();
    if (done) return;
    received += value?.byteLength ?? 0;
  }
  await reader.cancel();
}

/**
 * Delivers one signed callback attempt. Delivery failure is reported to the
 * caller (for logging/diagnostics) but is never allowed to influence the
 * verification's own result, per the threat model's SSRF and callback
 * requirements: HTTPS only, no private/loopback/metadata destinations,
 * bounded redirects re-validated at each hop, and bounded response size.
 */
export async function deliverCallback(
  destinationUrl: string,
  body: string,
  signingSecret: string,
): Promise<CallbackDeliveryResult> {
  let currentUrl = destinationUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let validatedUrl: URL;
    try {
      validatedUrl = await assertPublicHttpsUrl(currentUrl);
    } catch (error) {
      return { delivered: false, error: (error as Error).message };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(validatedUrl, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "powerotp-signature": signCallbackBody(body, signingSecret),
        },
        body,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || hop === MAX_REDIRECTS) {
          return { delivered: false, statusCode: response.status, error: "redirect_not_followed" };
        }
        currentUrl = new URL(location, validatedUrl).toString();
        continue;
      }

      await readLimitedBody(response);
      return {
        delivered: response.status >= 200 && response.status < 300,
        statusCode: response.status,
      };
    } catch (error) {
      return { delivered: false, error: (error as Error).message };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { delivered: false, error: "too_many_redirects" };
}
