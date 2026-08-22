import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedAuthDiditWebhookError,
  HostedAuthDiditWebhookService,
  createHostedAuthDiditWebhookService,
  signDiditWebhookV2ForTest,
  type HostedAuthDiditWebhookEvent,
  type HostedAuthDiditWebhookRepository,
} from "./hosted-auth-didit-webhook.js";

const secret = "didit-destination-secret";
const now = new Date("2026-08-22T08:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);
const sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const potpDiditId = `pdi_${"A".repeat(43)}`;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "9c0c8b8a-1111-4222-9333-444444444444",
    webhook_type: "status.updated",
    timestamp: nowSeconds,
    created_at: nowSeconds - 5,
    application_id: "11111111-2222-4333-8444-555555555555",
    environment: "live",
    session_id: sessionId,
    status: "Approved",
    vendor_data: potpDiditId,
    decision: { name: "José", document_number: "must-not-persist" },
    ...overrides,
  };
}

class MemoryRepository implements HostedAuthDiditWebhookRepository {
  readonly events = new Map<string, HostedAuthDiditWebhookEvent>();
  readonly cursors = new Map<string, Date>();

  async record(event: HostedAuthDiditWebhookEvent) {
    const existing = this.events.get(event.eventId);
    if (existing) {
      if (existing.payloadDigest !== event.payloadDigest) {
        throw new HostedAuthDiditWebhookError("conflicting_replay");
      }
      return "replayed" as const;
    }
    this.events.set(event.eventId, structuredClone(event));
    const cursor = this.cursors.get(event.providerOperationId);
    if (cursor && cursor > event.providerCreatedAt) return "stale" as const;
    this.cursors.set(event.providerOperationId, event.providerCreatedAt);
    return "accepted" as const;
  }
}

function service(repository = new MemoryRepository()) {
  return {
    repository,
    service: new HostedAuthDiditWebhookService(secret, repository, () => now),
  };
}

async function receive(
  webhook: HostedAuthDiditWebhookService,
  body: ReturnType<typeof payload>,
) {
  return webhook.receive({
    body,
    signatureV2: signDiditWebhookV2ForTest(body, secret),
    timestamp: String(body.timestamp),
  });
}

describe("hosted-auth Didit webhook service", () => {
  it("verifies canonical V2 Unicode JSON and retains only the minimal envelope", async () => {
    const { service: webhook, repository } = service();
    const signed = payload();
    const reordered = {
      decision: signed.decision,
      ...Object.fromEntries(
        Object.entries(signed).filter(([key]) => key !== "decision").reverse(),
      ),
    } as ReturnType<typeof payload>;
    const result = await webhook.receive({
      body: reordered,
      signatureV2: signDiditWebhookV2ForTest(signed, secret),
      timestamp: String(nowSeconds),
    });

    assert.equal(result.disposition, "accepted");
    const stored = repository.events.get(signed.event_id)!;
    assert.equal(stored.potpDiditId, potpDiditId);
    assert.equal("decision" in stored, false);
    assert.equal(JSON.stringify(stored).includes("must-not-persist"), false);
  });

  it("rejects forged bodies, stale timestamps, and unbound timestamp headers", async () => {
    const { service: webhook } = service();
    const body = payload();
    const signatureV2 = signDiditWebhookV2ForTest(body, secret);

    await assert.rejects(
      webhook.receive({
        body: { ...body, status: "Declined" },
        signatureV2,
        timestamp: String(nowSeconds),
      }),
      (error) =>
        error instanceof HostedAuthDiditWebhookError &&
        error.code === "invalid_signature",
    );
    for (const timestamp of [nowSeconds - 301, nowSeconds + 301]) {
      const stale = payload({ timestamp });
      await assert.rejects(
        webhook.receive({
          body: stale,
          signatureV2: signDiditWebhookV2ForTest(stale, secret),
          timestamp: String(timestamp),
        }),
        (error) =>
          error instanceof HostedAuthDiditWebhookError &&
          error.code === "invalid_timestamp",
      );
    }
    await assert.rejects(
      webhook.receive({
        body,
        signatureV2,
        timestamp: String(nowSeconds - 1),
      }),
      (error) =>
        error instanceof HostedAuthDiditWebhookError &&
        error.code === "invalid_timestamp",
    );
  });

  it("deduplicates refreshed retries, rejects conflicts, and ignores stale order", async () => {
    const { service: webhook, repository } = service();
    const first = payload();
    assert.equal((await receive(webhook, first)).disposition, "accepted");

    const retry = payload({ timestamp: nowSeconds + 60 });
    const retryService = new HostedAuthDiditWebhookService(
      secret,
      repository,
      () => new Date(now.getTime() + 60_000),
    );
    assert.equal((await receive(retryService, retry)).disposition, "replayed");

    const conflict = payload({ status: "Declined" });
    await assert.rejects(
      receive(webhook, conflict),
      (error) =>
        error instanceof HostedAuthDiditWebhookError &&
        error.code === "conflicting_replay",
    );
    const stale = payload({
      event_id: "2c0c8b8a-1111-4222-9333-444444444444",
      created_at: nowSeconds - 6,
    });
    assert.equal((await receive(webhook, stale)).disposition, "stale");
    const newer = payload({
      event_id: "3c0c8b8a-1111-4222-9333-444444444444",
      created_at: nowSeconds - 4,
    });
    assert.equal((await receive(webhook, newer)).disposition, "accepted");
  });

  it("stays disabled without the destination secret", () => {
    assert.equal(
      createHostedAuthDiditWebhookService({}, new MemoryRepository()),
      undefined,
    );
  });
});
