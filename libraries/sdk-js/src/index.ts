import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ChallengeSubmissionSchema,
  CodeSubmissionSchema,
  CreateVerificationSchema,
  ModalSessionAcceptedSchema,
  ModalSessionCreateSchema,
  VerificationAcceptedSchema,
  VerificationStatusSchema,
  type ChallengeSubmission,
  type CodeSubmission,
  type CreateVerification,
  type ModalSessionAccepted,
  type VerificationAccepted,
  type VerificationStatus,
  type VerificationType,
} from "@powerotp/contracts";

export interface PowerOtpClientOptions {
  apiKey: string;
  projectUrl: string;
  fetch?: typeof globalThis.fetch;
}

/** The replay window `verifyCallbackSignature` accepts, matching the
 * server's own tolerance in `apps/api/src/callback-signing.ts`. */
const CALLBACK_REPLAY_WINDOW_MS = 5 * 60 * 1_000;

export class PowerOtpClient {
  readonly #apiKey: string;
  readonly #projectUrl: URL;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: PowerOtpClientOptions) {
    if (!options.apiKey) throw new Error("POWEROTP apiKey is required");

    this.#projectUrl = new URL(options.projectUrl);
    if (this.#projectUrl.protocol !== "https:") {
      throw new Error("POWEROTP projectUrl must use HTTPS");
    }

    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async createVerification(
    request: CreateVerification,
    idempotencyKey: string,
  ): Promise<VerificationAccepted> {
    if (!idempotencyKey) throw new Error("Idempotency key is required");

    const body = CreateVerificationSchema.parse(request);
    const response = await this.#fetch(this.#projectUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    if (response.status !== 202) {
      throw new Error(`POWEROTP request failed with HTTP ${response.status}`);
    }

    return VerificationAcceptedSchema.parse(await response.json());
  }

  /**
   * Creates a short-lived "modal session" so this backend can hand its end
   * user a POWEROTP-hosted verification modal (`modalUrl`) without ever
   * knowing that end user's phone number up front — see
   * `docs/AS_BUILT.md`'s "Hosted verification modal" section. Resolved
   * against the same project URL as `createVerification` (their sibling
   * path, `.../modal-sessions` instead of `.../verifications`).
   */
  async createModalSession(allowedTypes?: VerificationType[]): Promise<ModalSessionAccepted> {
    const body = ModalSessionCreateSchema.parse({ allowedTypes });
    const modalSessionsUrl = new URL("modal-sessions", this.#projectUrl);
    const response = await this.#fetch(modalSessionsUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status !== 202) {
      throw new Error(`POWEROTP request failed with HTTP ${response.status}`);
    }

    return ModalSessionAcceptedSchema.parse(await response.json());
  }

  async getVerificationStatus(interactionId: string): Promise<VerificationStatus> {
    const url = new URL(`/v1/verifications/${interactionId}`, this.#projectUrl.origin);
    const response = await this.#fetch(url, {
      headers: { authorization: `Bearer ${this.#apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`POWEROTP request failed with HTTP ${response.status}`);
    }

    return VerificationStatusSchema.parse(await response.json());
  }

  /** Submits a customer-collected code or challenge answer on the
   * interaction's behalf, using this project's own API key rather than a
   * short-lived interaction token — for a backend that already knows the
   * response (e.g. it collected it through its own UI). */
  async submitResponse(
    interactionId: string,
    body: CodeSubmission | ChallengeSubmission,
  ): Promise<{ succeeded: boolean }> {
    const parsedBody = "code" in body ? CodeSubmissionSchema.parse(body) : ChallengeSubmissionSchema.parse(body);
    const url = new URL(`/v1/verifications/${interactionId}/response`, this.#projectUrl.origin);
    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parsedBody),
    });

    if (!response.ok) {
      throw new Error(`POWEROTP request failed with HTTP ${response.status}`);
    }

    return response.json() as Promise<{ succeeded: boolean }>;
  }
}

/**
 * Verifies a `powerotp-signature: t=<timestamp>,v1=<hmac>` callback header
 * against the exact raw request body a customer's server received —
 * mirrors `apps/api/src/callback-signing.ts#verifyCallbackSignature`
 * exactly (timestamped HMAC-SHA256, constant-time compare, same replay
 * window) so a customer never has to reimplement it by hand. Kept as a
 * small, duplicated primitive here rather than an `@powerotp/api`
 * dependency: that package is server-internal (BullMQ, MongoDB, AWS SDK,
 * ...), nothing a customer's own backend should ever need to install. If
 * the server-side signing scheme ever changes, this copy must change with
 * it.
 */
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
  if (Math.abs(now - timestamp) > CALLBACK_REPLAY_WINDOW_MS) return false;

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
