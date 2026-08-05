import {
  CreateVerificationSchema,
  VerificationAcceptedSchema,
  type CreateVerification,
  type VerificationAccepted,
} from "@powerotp/contracts";

export interface PowerOtpClientOptions {
  apiKey: string;
  projectUrl: string;
  fetch?: typeof globalThis.fetch;
}

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
}
