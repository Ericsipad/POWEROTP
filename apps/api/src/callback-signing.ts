import { createHmac, timingSafeEqual } from "node:crypto";

const REPLAY_WINDOW_MS = 5 * 60 * 1_000;

/**
 * Builds the `t=<timestamp>,v1=<hmac>` signature header used for signed
 * callbacks, following the same timestamped-HMAC shape documented for
 * customers to verify deliveries.
 */
export function signCallbackBody(body: string, secret: string, timestamp = Date.now()) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("base64url");
  return `t=${timestamp},v1=${signature}`;
}

export function verifyCallbackSignature(
  body: string,
  secret: string,
  header: string,
  now = Date.now(),
): boolean {
  const timestampMatch = /t=(\d+)/.exec(header);
  const signatureMatch = /v1=([\w-]+)/.exec(header);
  if (!timestampMatch || !signatureMatch) return false;

  const timestamp = Number(timestampMatch[1]);
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_MS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureMatch[1]!);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
