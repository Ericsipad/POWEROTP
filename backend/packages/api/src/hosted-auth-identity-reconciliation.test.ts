import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WrappedIdentityKeyRecord } from "./hosted-auth-durable-schemas.js";
import type {
  HostedAuthIdentityReconciliationRepository,
  PendingHostedIdentityArtifact,
} from "./hosted-auth-identity-reconciliation-repository.js";
import { HostedAuthIdentityReconciliationWorker } from "./hosted-auth-identity-reconciliation.js";

const personA = `hpi_${"A".repeat(43)}`;
const personB = `hpi_${"B".repeat(42)}A`;
const personC = `hpi_${"C".repeat(42)}A`;
const profileA = `hap_${"A".repeat(43)}`;
const profileB = `hap_${"B".repeat(42)}A`;
const now = new Date("2026-08-22T03:00:00.000Z");
const old = new Date("2026-08-22T02:00:00.000Z");

function complete(
  hostedPersonIdentityId: string,
  hostedAuthProfileId: string,
  identityDataMode: "powerotp_pii" | "didit_pii",
): PendingHostedIdentityArtifact {
  return {
    hostedPersonIdentityId,
    personStatus: "pending",
    verificationCount: 0,
    profiles: [
      {
        hostedAuthProfileId,
        identityDataMode,
        rpId:
          identityDataMode === "powerotp_pii"
            ? "authx.powerotp.com"
            : "authz.powerotp.com",
        profileStatus: "pending",
        contactStatus: "pending",
        contactCount: 1,
        encryptedAttributeCount: identityDataMode === "powerotp_pii" ? 1 : 0,
        validCustodyContactCount: 1,
        providerReferenceCount: identityDataMode === "didit_pii" ? 1 : 0,
        credentialCount: 0,
        consentCount: 0,
      },
    ],
  };
}

class MemoryIdentities implements HostedAuthIdentityReconciliationRepository {
  readonly artifacts = new Map<string, PendingHostedIdentityArtifact>();
  claimed = new Set<string>();
  deleted: string[] = [];

  async claimStalePending() {
    const ids = [...this.artifacts.keys()].filter((id) => !this.claimed.has(id));
    ids.forEach((id) => this.claimed.add(id));
    return ids;
  }

  async inspect(hostedPersonIdentityId: string) {
    return this.artifacts.get(hostedPersonIdentityId) ?? null;
  }

  async personExists(hostedPersonIdentityId: string) {
    return this.artifacts.has(hostedPersonIdentityId);
  }

  async deletePending(hostedPersonIdentityId: string) {
    const artifact = this.artifacts.get(hostedPersonIdentityId);
    if (!artifact || artifact.personStatus !== "pending") return false;
    this.artifacts.delete(hostedPersonIdentityId);
    this.deleted.push(hostedPersonIdentityId);
    return true;
  }
}

class MemoryKeys {
  readonly records = new Map<string, WrappedIdentityKeyRecord>();
  deleted: string[] = [];

  async findActive(hostedPersonIdentityId: string) {
    return this.records.get(hostedPersonIdentityId) ?? null;
  }

  async deleteActive(hostedPersonIdentityId: string) {
    const deleted = this.records.delete(hostedPersonIdentityId);
    if (deleted) this.deleted.push(hostedPersonIdentityId);
    return deleted;
  }

  async listActiveBefore(
    before: Date,
    limit: number,
    after?: { createdAt: Date; hostedPersonIdentityId: string },
  ) {
    return [...this.records.values()]
      .filter(({ createdAt }) => createdAt < before)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.hostedPersonIdentityId.localeCompare(
            right.hostedPersonIdentityId,
          ),
      )
      .filter(
        (record) =>
          !after ||
          record.createdAt > after.createdAt ||
          (record.createdAt.getTime() === after.createdAt.getTime() &&
            record.hostedPersonIdentityId > after.hostedPersonIdentityId),
      )
      .slice(0, limit);
  }

  add(hostedPersonIdentityId: string) {
    this.records.set(hostedPersonIdentityId, {
      hostedPersonIdentityId,
      kmsKeyVersion: "kek_v1",
      wrappedDekCiphertext: "QQ",
      status: "active",
      createdAt: old,
    });
  }
}

function fixture() {
  const identities = new MemoryIdentities();
  const keys = new MemoryKeys();
  const bound = new Set<string>();
  const retries: string[] = [];
  const worker = new HostedAuthIdentityReconciliationWorker(
    identities,
    keys,
    { hasForPerson: async (id) => bound.has(id) },
    async ({ hostedPersonIdentityId }) => void retries.push(hostedPersonIdentityId),
    () => now,
  );
  return { identities, keys, bound, retries, worker };
}

describe("hosted-auth identity reconciliation worker", () => {
  it("retries complete pending artifacts within their custody modes", async () => {
    const state = fixture();
    state.identities.artifacts.set(
      personA,
      complete(personA, profileA, "powerotp_pii"),
    );
    state.identities.artifacts.set(
      personB,
      complete(personB, profileB, "didit_pii"),
    );
    state.keys.add(personA);
    state.keys.add(personB);

    const results = await state.worker.runOnce();

    assert.deepEqual(state.retries, [personA, personB]);
    assert.deepEqual(
      results.map(({ action }) => action),
      ["retried", "retried"],
    );
    assert.equal(state.keys.records.has(personA), true);
    assert.equal(state.keys.records.has(personB), false);
    assert.equal(state.identities.artifacts.size, 2);
  });

  it("detects and compensates a standalone stale wrapped-key orphan", async () => {
    const state = fixture();
    state.keys.add(personC);

    assert.deepEqual(await state.worker.runOnce(), [
      { hostedPersonIdentityId: personC, action: "orphan_key_cleaned" },
    ]);
    assert.deepEqual(state.keys.deleted, [personC]);
  });

  it("paginates past a live identity key to find a later orphan", async () => {
    const state = fixture();
    state.identities.artifacts.set(
      personA,
      complete(personA, profileA, "powerotp_pii"),
    );
    state.keys.add(personA);
    state.keys.add(personB);

    const results = await state.worker.runOnce(1);

    assert.deepEqual(
      results.map(({ action }) => action),
      ["retried", "orphan_key_cleaned"],
    );
    assert.equal(state.keys.records.has(personA), true);
    assert.equal(state.keys.records.has(personB), false);
  });

  it("cleans a POWEROTP partial store when its wrapped key is missing", async () => {
    const state = fixture();
    state.identities.artifacts.set(
      personA,
      complete(personA, profileA, "powerotp_pii"),
    );

    const [result] = await state.worker.runOnce();

    assert.equal(result?.action, "partial_identity_cleaned");
    assert.equal(result?.reason, "missing_wrapped_key");
    assert.deepEqual(state.identities.deleted, [personA]);
    assert.deepEqual(state.retries, []);
  });

  it("does not repeat a retry on an immediate duplicate worker run", async () => {
    const state = fixture();
    state.identities.artifacts.set(
      personA,
      complete(personA, profileA, "powerotp_pii"),
    );
    state.keys.add(personA);

    await state.worker.runOnce();
    const duplicate = await state.worker.runOnce();

    assert.deepEqual(duplicate, []);
    assert.deepEqual(state.retries, [personA]);
  });

  it("isolates one retry failure and continues cleaning another artifact", async () => {
    const state = fixture();
    state.identities.artifacts.set(
      personA,
      complete(personA, profileA, "powerotp_pii"),
    );
    state.keys.add(personA);
    state.identities.artifacts.set(personB, {
      hostedPersonIdentityId: personB,
      personStatus: "pending",
      verificationCount: 0,
      profiles: [],
    });
    const worker = new HostedAuthIdentityReconciliationWorker(
      state.identities,
      state.keys,
      { hasForPerson: async () => false },
      async () => {
        throw new Error("retry unavailable");
      },
      () => now,
    );

    const results = await worker.runOnce();

    assert.deepEqual(
      results.map(({ action }) => action),
      ["failed", "partial_identity_cleaned"],
    );
    assert.equal(state.identities.artifacts.has(personA), true);
    assert.equal(state.identities.artifacts.has(personB), false);
  });

  it("preserves bound and provider-referenced partial artifacts", async () => {
    const state = fixture();
    const completeDidit = complete(personB, profileB, "didit_pii");
    const providerPartial = {
      ...completeDidit,
      profiles: [
        {
          ...completeDidit.profiles[0]!,
          validCustodyContactCount: 0,
        },
      ],
    };
    state.identities.artifacts.set(personA, {
      hostedPersonIdentityId: personA,
      personStatus: "pending",
      verificationCount: 0,
      profiles: [],
    });
    state.identities.artifacts.set(personB, providerPartial);
    state.bound.add(personA);

    const results = await state.worker.runOnce();

    assert.deepEqual(
      results.map(({ reason }) => reason),
      ["pending_identity_has_binding", "provider_cleanup_required"],
    );
    assert.equal(state.identities.artifacts.size, 2);
  });

  it("hands provider-referenced partial artifacts to durable deletion cleanup", async () => {
    const state = fixture();
    const didit = complete(personB, profileB, "didit_pii");
    state.identities.artifacts.set(personB, {
      ...didit,
      profiles: [
        {
          ...didit.profiles[0]!,
          validCustodyContactCount: 0,
        },
      ],
    });
    const scheduled: string[] = [];
    const worker = new HostedAuthIdentityReconciliationWorker(
      state.identities,
      state.keys,
      { hasForPerson: async () => false },
      async () => undefined,
      () => now,
      async (id) => {
        scheduled.push(id);
        return "scheduled";
      },
    );

    assert.deepEqual(await worker.runOnce(), [
      {
        hostedPersonIdentityId: personB,
        action: "provider_cleanup_scheduled",
      },
    ]);
    assert.deepEqual(scheduled, [personB]);
    assert.equal(state.identities.artifacts.has(personB), true);
  });
});
