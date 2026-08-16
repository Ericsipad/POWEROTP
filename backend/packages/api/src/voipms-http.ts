export const VOIPMS_API_URL = "https://voip.ms/api/v1/rest.php";

export type VoipMsHttpFailure =
  | { kind: "network"; error: string }
  | { kind: "http"; status: number; bodyPreview: string }
  | { kind: "bad_json"; status: number; contentType: string | null };

export type VoipMsHttpResult =
  | { ok: true; body: unknown }
  | { ok: false; failure: VoipMsHttpFailure };

/**
 * The one place that actually talks to VoIP.ms's REST endpoint — shared by
 * `sms.ts` (sending) and `voipms-billing-client.ts` (reading back CDR/SMS
 * records for cost reconciliation) so the one real, live-confirmed
 * transport quirk only needs fixing in one place. VoIP.ms's REST endpoint
 * only accepts `multipart/form-data` for POST, not
 * `application/x-www-form-urlencoded` (see `docs/AS_BUILT.md`'s "Incident:
 * SMS sends failed with a misleading provider_unavailable" — a
 * `application/x-www-form-urlencoded` body gets misrouted into VoIP.ms's
 * SOAP handler and returns a `500` SOAP fault even with otherwise-correct
 * parameters). Using `FormData` as the body lets `fetch` set the correct
 * `multipart/form-data; boundary=` header itself — never set `content-type`
 * manually here. Never throws: every failure mode (network, non-2xx,
 * invalid JSON) is returned as a typed result so callers can log/classify
 * it themselves without a mandatory try/catch at every call site.
 */
export async function postVoipMsApi(
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<VoipMsHttpResult> {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    form.set(key, value);
  }

  let response: Response;
  try {
    response = await fetchImpl(VOIPMS_API_URL, {
      method: "POST",
      headers: { accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      ok: false,
      failure: { kind: "network", error: error instanceof Error ? error.message : String(error) },
    };
  }

  if (!response.ok) {
    // Never contains credentials — VoIP.ms's own response body, at most.
    const bodyPreview = await response.text().then(
      (text) => text.slice(0, 300),
      () => "<unreadable>",
    );
    return { ok: false, failure: { kind: "http", status: response.status, bodyPreview } };
  }

  try {
    return { ok: true, body: await response.json() };
  } catch {
    return {
      ok: false,
      failure: {
        kind: "bad_json",
        status: response.status,
        contentType: response.headers.get("content-type"),
      },
    };
  }
}
