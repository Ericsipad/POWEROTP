import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedAuthDiditReconciliationError,
  HostedAuthDiditReconciliationService,
  createHostedAuthDiditReconciliationService,
  type HostedAuthDiditReconciliationRepository,
  type HostedAuthDiditReconciliationSnapshot,
} from "./hosted-auth-didit-reconciliation.js";

const providerOperationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const workflowId = "11111111-2222-4333-8444-555555555555";
const potpDiditId = `pdi_${"A".repeat(43)}`;
const now = new Date("2026-08-22T08:30:00.000Z");

function decision(overrides: Record<string, unknown> = {}) {
  return {
    session_id: providerOperationId,
    session_kind: "user",
    status: "Approved",
    environment: "live",
    workflow_id: workflowId,
    vendor_data: potpDiditId,
    id_verifications: [
      {
        full_name: "Must Not Persist",
        document_number: "123456789",
      },
    ],
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    providerOperationId,
    potpDiditId,
    workflowId,
    environment: "live" as const,
    attempt: 1,
    ...overrides,
  };
}

class MemoryRepository implements HostedAuthDiditReconciliationRepository {
  snapshot: HostedAuthDiditReconciliationSnapshot | undefined;
  disposition: "accepted" | "unchanged" = "accepted";

  async reconcile(snapshot: HostedAuthDiditReconciliationSnapshot) {
    this.snapshot = structuredClone(snapshot);
    return this.disposition;
  }
}

function service(
  response: Response | (() => Promise<Response>),
  repository = new MemoryRepository(),
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  return {
    calls,
    repository,
    service: new HostedAuthDiditReconciliationService(
      "server-api-key",
      repository,
      async (url, init) => {
        calls.push({ url: String(url), init });
        return typeof response === "function" ? response() : response;
      },
      () => now,
    ),
  };
}

describe("hosted-auth Didit reconciliation", () => {
  it("polls the bound user session and persists only its minimal envelope", async () => {
    const state = service(Response.json(decision()));
    const result = await state.service.reconcile(request());

    assert.equal(result.outcome, "reconciled");
    assert.equal(result.disposition, "accepted");
    assert.deepEqual(state.repository.snapshot, {
      providerOperationId,
      potpDiditId,
      workflowId,
      environment: "live",
      status: "Approved",
      reconciledAt: now,
    });
    assert.equal(
      JSON.stringify(state.repository.snapshot).includes("Must Not Persist"),
      false,
    );
    assert.equal(
      state.calls[0]?.url,
      `https://verification.didit.me/v3/session/${providerOperationId}/decision/`,
    );
    assert.equal(
      new Headers(state.calls[0]?.init?.headers).get("x-api-key"),
      "server-api-key",
    );
    assert.equal(state.calls[0]?.init?.redirect, "error");
  });

  it("returns bounded backoff for transport, rate-limit, outage, and missing-session failures", async () => {
    const cases = [
      {
        response: () => Promise.reject(new Error("network outage")),
        attempt: 1,
        reason: "provider_unavailable",
        delay: 10_000,
      },
      {
        response: new Response(null, { status: 503 }),
        attempt: 2,
        reason: "provider_unavailable",
        delay: 20_000,
      },
      {
        response: new Response(null, { status: 429 }),
        attempt: 3,
        reason: "rate_limited",
        delay: 40_000,
      },
      {
        response: new Response(null, { status: 404 }),
        attempt: 10,
        reason: "session_not_found",
        delay: 60_000,
      },
    ] as const;

    for (const testCase of cases) {
      const state = service(testCase.response);
      assert.deepEqual(
        await state.service.reconcile(
          request({ attempt: testCase.attempt }),
        ),
        {
          outcome: "retryable_failure",
          reason: testCase.reason,
          nextPollAfterMs: testCase.delay,
        },
      );
      assert.equal(state.repository.snapshot, undefined);
    }
  });

  it("fails closed on authentication, malformed responses, and binding mismatches", async () => {
    const cases = [
      {
        response: new Response(null, { status: 403 }),
        code: "provider_authentication_failed",
      },
      {
        response: Response.json(decision({ status: "APPROVED" })),
        code: "provider_contract_mismatch",
      },
      {
        response: Response.json(decision({ session_kind: "business" })),
        code: "provider_contract_mismatch",
      },
      {
        response: Response.json(
          decision({ vendor_data: `pdi_${"B".repeat(42)}A` }),
        ),
        code: "provider_binding_mismatch",
      },
      {
        response: Response.json(
          decision({
            workflow_id: "22222222-3333-4444-8555-666666666666",
          }),
        ),
        code: "provider_binding_mismatch",
      },
    ] as const;

    for (const testCase of cases) {
      const state = service(testCase.response);
      await assert.rejects(
        state.service.reconcile(request()),
        (error) =>
          error instanceof HostedAuthDiditReconciliationError &&
          error.code === testCase.code,
      );
      assert.equal(state.repository.snapshot, undefined);
    }
  });

  it("preserves unchanged repository outcomes and disables without credentials", async () => {
    const repository = new MemoryRepository();
    repository.disposition = "unchanged";
    const state = service(
      Response.json(decision({ status: "In Progress" })),
      repository,
    );
    const result = await state.service.reconcile(request());
    assert.equal(result.outcome, "reconciled");
    assert.equal(result.disposition, "unchanged");
    assert.equal(result.snapshot.status, "In Progress");
    assert.equal(
      createHostedAuthDiditReconciliationService({}, repository),
      undefined,
    );
  });
});
