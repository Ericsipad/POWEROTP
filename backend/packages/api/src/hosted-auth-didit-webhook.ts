import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { PotpDiditIdSchema } from "@powerotp/contracts";
import { z } from "zod";

import type { ProductionConfig } from "./config.js";

const DIDIT_WEBHOOK_TOLERANCE_SECONDS = 300;

const DiditSessionWebhookSchema = z
  .object({
    event_id: z.uuid(),
    webhook_type: z.enum(["status.updated", "data.updated"]),
    timestamp: z.number().int().nonnegative(),
    created_at: z.number().int().nonnegative(),
    application_id: z.uuid(),
    environment: z.enum(["live", "sandbox"]),
    session_id: z.uuid(),
    status: z.string().min(1).max(100),
    vendor_data: PotpDiditIdSchema,
    workflow_id: z.uuid().optional(),
  })
  .passthrough();

export type HostedAuthDiditWebhookEvent = Readonly<{
  eventId: string;
  eventType: "status.updated" | "data.updated";
  applicationId: string;
  environment: "live" | "sandbox";
  providerOperationId: string;
  potpDiditId: string;
  status: string;
  workflowId?: string;
  providerCreatedAt: Date;
  receivedAt: Date;
  payloadDigest: string;
}>;

export type HostedAuthDiditWebhookDisposition =
  | "accepted"
  | "replayed"
  | "stale";

export interface HostedAuthDiditWebhookRepository {
  record(
    event: HostedAuthDiditWebhookEvent,
  ): Promise<HostedAuthDiditWebhookDisposition>;
}

export class HostedAuthDiditWebhookError extends Error {
  constructor(
    readonly code:
      | "invalid_signature"
      | "invalid_timestamp"
      | "conflicting_replay",
  ) {
    super(`hosted_auth_didit_webhook_${code}`);
  }
}

/**
 * Authenticates Didit's full, middleware-safe V2 body before retaining only
 * the PII-free event envelope needed for idempotency and ordering.
 */
export class HostedAuthDiditWebhookService {
  constructor(
    private readonly secret: string,
    private readonly repository: HostedAuthDiditWebhookRepository,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (secret.length === 0) throw new Error("Didit webhook secret is required");
  }

  async receive(input: {
    body: unknown;
    signatureV2: string | undefined;
    timestamp: string | undefined;
  }): Promise<
    Readonly<{
      disposition: HostedAuthDiditWebhookDisposition;
      event: HostedAuthDiditWebhookEvent;
    }>
  > {
    const receivedAt = this.now();
    const timestamp = parseTimestamp(input.timestamp, receivedAt);
    const canonicalBody = canonicalJson(input.body);
    if (!validSignature(canonicalBody, input.signatureV2, this.secret)) {
      throw new HostedAuthDiditWebhookError("invalid_signature");
    }

    const payload = DiditSessionWebhookSchema.parse(input.body);
    if (payload.timestamp !== timestamp) {
      throw new HostedAuthDiditWebhookError("invalid_timestamp");
    }
    const semanticPayload = Object.fromEntries(
      Object.entries(payload).filter(([key]) => key !== "timestamp"),
    );
    const event: HostedAuthDiditWebhookEvent = {
      eventId: payload.event_id,
      eventType: payload.webhook_type,
      applicationId: payload.application_id,
      environment: payload.environment,
      providerOperationId: payload.session_id,
      potpDiditId: payload.vendor_data,
      status: payload.status,
      ...(payload.workflow_id ? { workflowId: payload.workflow_id } : {}),
      providerCreatedAt: new Date(payload.created_at * 1_000),
      receivedAt,
      payloadDigest: createHash("sha256")
        .update(canonicalJson(semanticPayload), "utf8")
        .digest("base64url"),
    };
    return {
      disposition: await this.repository.record(event),
      event,
    };
  }
}

export function createHostedAuthDiditWebhookService(
  config: Pick<ProductionConfig, "DIDIT_WEBHOOK_SECRET">,
  repository: HostedAuthDiditWebhookRepository,
  now?: () => Date,
): HostedAuthDiditWebhookService | undefined {
  return config.DIDIT_WEBHOOK_SECRET
    ? new HostedAuthDiditWebhookService(
        config.DIDIT_WEBHOOK_SECRET,
        repository,
        now,
      )
    : undefined;
}

export function signDiditWebhookV2ForTest(
  body: unknown,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(canonicalJson(body), "utf8")
    .digest("hex");
}

function parseTimestamp(header: string | undefined, now: Date): number {
  if (!header || !/^\d{1,12}$/.test(header)) {
    throw new HostedAuthDiditWebhookError("invalid_timestamp");
  }
  const timestamp = Number(header);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > DIDIT_WEBHOOK_TOLERANCE_SECONDS
  ) {
    throw new HostedAuthDiditWebhookError("invalid_timestamp");
  }
  return timestamp;
}

function validSignature(
  canonicalBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret)
    .update(canonicalBody, "utf8")
    .digest();
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  throw new HostedAuthDiditWebhookError("invalid_signature");
}
