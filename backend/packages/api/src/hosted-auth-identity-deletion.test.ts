import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  HostedAuthDeletionCandidate,
  HostedAuthDeletionEvidenceDisposition,
  HostedAuthIdentityDeletionRepository,
} from "./hosted-auth-identity-deletion-contracts.js";
import { HostedAuthIdentityDeletionOrchestrator } from "./hosted-auth-identity-deletion.js";

const personA = `hpi_${"A".repeat(43)}`;
const personB = `hpi_${"B".repeat(42)}A`;
const requestedAt = new Date("2026-08-22T03:00:00.000Z");
const eligibleAt = new Date("2026-08-23T03:00:00.000Z");

class MemoryDeletionRepository
  implements HostedAuthIdentityDeletionRepository
{
  readonly scheduled = new Map<
    string,
    {
      requestedAt: Date;
      eligibleAt: Date;
      claimedAt?: Date;
      candidate: HostedAuthDeletionCandidate;
    }
  >();
  readonly finalized: Array<{
    hostedPersonIdentityId: string;
    providerCleanupConfirmed: boolean;
    evidence: HostedAuthDeletionEvidenceDisposition;
  }> = [];
  finalizeFails = false;

  async schedule(input: {
    hostedPersonIdentityId: string;
    requestedAt: Date;
    eligibleAt: Date;
  }) {
    if (this.scheduled.has(input.hostedPersonIdentityId)) return "duplicate" as const;
    this.scheduled.set(input.hostedPersonIdentityId, {
      requestedAt: input.requestedAt,
      eligibleAt: input.eligibleAt,
      candidate: {
        hostedPersonIdentityId: input.hostedPersonIdentityId,
        providerIdentityReferences: [],
        providerContactReferences: [],
      },
    });
    return "scheduled" as const;
  }

  async scheduleAbandonedProviderIdentity(input: {
    hostedPersonIdentityId: string;
    requestedAt: Date;
  }) {
    return this.schedule({
      ...input,
      eligibleAt: input.requestedAt,
    });
  }

  async claimEligible(input: {
    now: Date;
    leaseExpiredBefore: Date;
    limit: number;
  }) {
    return [...this.scheduled.values()]
      .filter(
        (record) =>
          record.eligibleAt <= input.now &&
          (!record.claimedAt || record.claimedAt < input.leaseExpiredBefore),
      )
      .slice(0, input.limit)
      .map((record) => {
        record.claimedAt = input.now;
        return record.candidate;
      });
  }

  async finalize(input: {
    hostedPersonIdentityId: string;
    providerCleanupConfirmed: boolean;
    evidence: HostedAuthDeletionEvidenceDisposition;
  }) {
    if (this.finalizeFails) throw new Error("identity store unavailable");
    this.finalized.push(input);
    this.scheduled.delete(input.hostedPersonIdentityId);
    return "completed" as const;
  }

  addCandidate(candidate: HostedAuthDeletionCandidate, eligible = requestedAt) {
    this.scheduled.set(candidate.hostedPersonIdentityId, {
      requestedAt,
      eligibleAt: eligible,
      candidate,
    });
  }
}

function fixture(now = requestedAt) {
  const identities = new MemoryDeletionRepository();
  const operations: string[] = [];
  const providerInputs: HostedAuthDeletionCandidate[] = [];
  let providerFails = false;
  const worker = new HostedAuthIdentityDeletionOrchestrator(
    identities,
    {
      purgeForIdentity: async (id) => {
        operations.push(`runtime:${id}`);
      },
    },
    {
      deleteIdentityArtifacts: async (input) => {
        operations.push(`provider:${input.hostedPersonIdentityId}`);
        providerInputs.push(input);
        if (providerFails) throw new Error("provider unavailable");
        return "confirmed";
      },
    },
    {
      markDeletedForPerson: async (id) => {
        operations.push(`bindings:${id}`);
      },
    },
    async () => ({
      retainConsentEvidence: true,
      retainVerificationEvidence: false,
    }),
    () => now,
  );
  return {
    identities,
    operations,
    providerInputs,
    worker,
    failProvider: () => {
      providerFails = true;
    },
  };
}

describe("hosted-auth identity deletion orchestration", () => {
  it("blocks immediately but waits for the caller-supplied retention eligibility", async () => {
    const state = fixture(requestedAt);

    assert.equal(
      await state.worker.schedule({
        hostedPersonIdentityId: personA,
        eligibleAt,
      }),
      "scheduled",
    );
    const schedule = state.identities.scheduled.get(personA);
    assert.equal(schedule?.requestedAt, requestedAt);
    assert.equal(schedule?.eligibleAt, eligibleAt);
    assert.deepEqual(await state.worker.runOnce(), []);
    assert.equal(
      await state.worker.schedule({
        hostedPersonIdentityId: personA,
        eligibleAt,
      }),
      "duplicate",
    );
  });

  it("purges runtime and provider artifacts before bindings and local finalization", async () => {
    const state = fixture();
    state.identities.addCandidate({
      hostedPersonIdentityId: personA,
      providerIdentityReferences: ["provider_user:opaque"],
      providerContactReferences: ["provider_contact:opaque"],
    });

    assert.deepEqual(await state.worker.runOnce(), [
      { hostedPersonIdentityId: personA, action: "completed" },
    ]);
    assert.deepEqual(state.operations, [
      `runtime:${personA}`,
      `provider:${personA}`,
      `bindings:${personA}`,
    ]);
    assert.deepEqual(state.providerInputs[0], {
      hostedPersonIdentityId: personA,
      providerIdentityReferences: ["provider_user:opaque"],
      providerContactReferences: ["provider_contact:opaque"],
    });
    assert.deepEqual(state.identities.finalized, [
      {
        hostedPersonIdentityId: personA,
        completedAt: requestedAt,
        providerCleanupConfirmed: true,
        evidence: {
          retainConsentEvidence: true,
          retainVerificationEvidence: false,
        },
      },
    ]);
  });

  it("preserves provider references on failure and retries only after the lease", async () => {
    const state = fixture();
    state.identities.addCandidate({
      hostedPersonIdentityId: personA,
      providerIdentityReferences: ["provider_user:opaque"],
      providerContactReferences: [],
    });
    state.failProvider();

    assert.equal((await state.worker.runOnce())[0]?.action, "failed");
    assert.equal(state.identities.scheduled.has(personA), true);
    assert.deepEqual(state.identities.finalized, []);
    assert.deepEqual(state.operations, [
      `runtime:${personA}`,
      `provider:${personA}`,
    ]);
    assert.deepEqual(await state.worker.runOnce(), []);
  });

  it("skips provider calls when no provider reference exists", async () => {
    const state = fixture();
    state.identities.addCandidate({
      hostedPersonIdentityId: personA,
      providerIdentityReferences: [],
      providerContactReferences: [],
    });

    await state.worker.runOnce();

    assert.deepEqual(state.operations, [
      `runtime:${personA}`,
      `bindings:${personA}`,
    ]);
    assert.equal(
      state.identities.finalized[0]?.providerCleanupConfirmed,
      false,
    );
  });

  it("keeps the deletion retryable after a partial-store finalization failure", async () => {
    const state = fixture();
    state.identities.addCandidate({
      hostedPersonIdentityId: personA,
      providerIdentityReferences: [],
      providerContactReferences: [],
    });
    state.identities.finalizeFails = true;

    assert.equal((await state.worker.runOnce())[0]?.action, "failed");
    assert.equal(state.identities.scheduled.has(personA), true);
    assert.deepEqual(state.identities.finalized, []);
  });

  it("failure-isolates candidates without exposing their provider references", async () => {
    const state = fixture();
    state.identities.addCandidate({
      hostedPersonIdentityId: personA,
      providerIdentityReferences: ["provider_user:opaque"],
      providerContactReferences: [],
    });
    state.identities.addCandidate({
      hostedPersonIdentityId: personB,
      providerIdentityReferences: [],
      providerContactReferences: [],
    });
    state.failProvider();

    const results = await state.worker.runOnce();

    assert.deepEqual(
      results.map(({ action }) => action),
      ["failed", "completed"],
    );
    assert.equal(JSON.stringify(results).includes("provider_user"), false);
    assert.equal(state.identities.scheduled.has(personA), true);
    assert.equal(state.identities.scheduled.has(personB), false);
  });

  it("schedules abandoned provider artifacts without an invented delay", async () => {
    const state = fixture();

    await state.worker.scheduleAbandonedProviderIdentity(personA);

    const schedule = state.identities.scheduled.get(personA);
    assert.equal(schedule?.requestedAt, requestedAt);
    assert.equal(schedule?.eligibleAt, requestedAt);
  });
});
