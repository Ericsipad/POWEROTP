import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Collection, Db } from "mongodb";

import { WrappedIdentityKeyRepository } from "./hosted-auth-durable-repository.js";
import type {
  WrappedIdentityKeyDocument,
  WrappedIdentityKeyRecord,
} from "./hosted-auth-durable-schemas.js";
import {
  HostedAuthIdentityCryptoShredder,
  type HostedAuthIdentityKeyLifecycleAuthority,
} from "./hosted-auth-identity-crypto-shredding.js";

const personA = `hpi_${"A".repeat(43)}`;
const personB = `hpi_${"B".repeat(42)}A`;
const createdAt = new Date("2026-08-22T02:00:00.000Z");
const shreddedAt = new Date("2026-08-22T03:00:00.000Z");
const wrappedCiphertext = "C".repeat(64);

class MemoryWrappedKeyCollection {
  readonly documents = new Map<string, WrappedIdentityKeyDocument>();
  failUpdates = false;

  async findOne(filter: { _id: string; status?: string }) {
    const document = this.documents.get(filter._id);
    if (!document || (filter.status && document.status !== filter.status)) {
      return null;
    }
    return structuredClone(document);
  }

  async updateOne(
    filter: { _id: string; status?: string },
    update:
      | { $setOnInsert: WrappedIdentityKeyDocument }
      | {
          $set: { status: "crypto_shredded"; cryptoShreddedAt: Date };
          $unset: { wrappedDekCiphertext: string };
        },
  ) {
    if ("$setOnInsert" in update) {
      if (this.documents.has(filter._id)) {
        return { upsertedCount: 0, modifiedCount: 0 };
      }
      this.documents.set(filter._id, structuredClone(update.$setOnInsert));
      return { upsertedCount: 1, modifiedCount: 0 };
    }
    if (this.failUpdates) throw new Error("wrapped-key store unavailable");
    const document = this.documents.get(filter._id);
    if (!document || (filter.status && document.status !== filter.status)) {
      return { upsertedCount: 0, modifiedCount: 0 };
    }
    this.documents.set(filter._id, {
      _id: document._id,
      hostedPersonIdentityId: document.hostedPersonIdentityId,
      kmsKeyVersion: document.kmsKeyVersion,
      status: "crypto_shredded",
      createdAt: document.createdAt,
      cryptoShreddedAt: update.$set.cryptoShreddedAt,
    });
    return { upsertedCount: 0, modifiedCount: 1 };
  }

  async deleteOne() {
    return { deletedCount: 0 };
  }

  restoreActive(hostedPersonIdentityId: string) {
    this.documents.set(hostedPersonIdentityId, activeKey(hostedPersonIdentityId));
  }
}

class MemoryLifecycleAuthority
  implements HostedAuthIdentityKeyLifecycleAuthority
{
  readonly operations: string[] = [];
  readonly shredded = new Map<string, Date>();
  denyAuthorization = false;
  failRecordOnce = false;

  async authorizeCryptoShred(input: {
    hostedPersonIdentityId: string;
    satisfiedAt: Date;
  }) {
    this.operations.push(`authorize:${input.hostedPersonIdentityId}`);
    if (this.denyAuthorization) throw new Error("retention is not eligible");
    return this.shredded.has(input.hostedPersonIdentityId)
      ? ("duplicate" as const)
      : ("authorized" as const);
  }

  async recordCryptoShredded(input: {
    hostedPersonIdentityId: string;
    cryptoShreddedAt: Date;
  }) {
    this.operations.push(`record:${input.hostedPersonIdentityId}`);
    if (this.failRecordOnce) {
      this.failRecordOnce = false;
      throw new Error("identity store unavailable");
    }
    if (this.shredded.has(input.hostedPersonIdentityId)) {
      return "duplicate" as const;
    }
    this.shredded.set(
      input.hostedPersonIdentityId,
      input.cryptoShreddedAt,
    );
    return "recorded" as const;
  }

  async assertKeyUsable(hostedPersonIdentityId: string) {
    if (this.shredded.has(hostedPersonIdentityId)) {
      throw new Error("Hosted-auth identity key is permanently unavailable");
    }
  }

  async listCryptoShredded(input: {
    afterIdentityId?: string;
    limit: number;
  }) {
    return [...this.shredded]
      .filter(([identityId]) => !input.afterIdentityId || identityId > input.afterIdentityId)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, input.limit)
      .map(([hostedPersonIdentityId, cryptoShreddedAt]) => ({
        hostedPersonIdentityId,
        cryptoShreddedAt,
      }));
  }
}

function activeKey(hostedPersonIdentityId: string): WrappedIdentityKeyDocument {
  const record: WrappedIdentityKeyRecord = {
    hostedPersonIdentityId,
    kmsKeyVersion: "kek_v1",
    wrappedDekCiphertext: wrappedCiphertext,
    status: "active",
    createdAt,
  };
  return { _id: hostedPersonIdentityId, ...record };
}

function fixture() {
  const collection = new MemoryWrappedKeyCollection();
  collection.restoreActive(personA);
  const authority = new MemoryLifecycleAuthority();
  const keys = new WrappedIdentityKeyRepository(
    {} as Db,
    collection as unknown as Collection<WrappedIdentityKeyDocument>,
  );
  return {
    authority,
    collection,
    shredder: new HostedAuthIdentityCryptoShredder(authority, keys),
  };
}

describe("hosted-auth identity crypto-shredding", () => {
  it("atomically removes wrapped ciphertext and leaves an idempotent tombstone", async () => {
    const state = fixture();

    await state.shredder.shred({
      hostedPersonIdentityId: personA,
      completedAt: shreddedAt,
    });
    await state.shredder.shred({
      hostedPersonIdentityId: personA,
      completedAt: shreddedAt,
    });

    assert.deepEqual(state.collection.documents.get(personA), {
      _id: personA,
      hostedPersonIdentityId: personA,
      kmsKeyVersion: "kek_v1",
      status: "crypto_shredded",
      createdAt,
      cryptoShreddedAt: shreddedAt,
    });
    assert.equal(state.authority.shredded.get(personA), shreddedAt);
  });

  it("fails closed before key removal when retention/provider authorization is absent", async () => {
    const state = fixture();
    state.authority.denyAuthorization = true;

    await assert.rejects(
      state.shredder.shred({
        hostedPersonIdentityId: personA,
        completedAt: shreddedAt,
      }),
      /retention is not eligible/,
    );

    assert.equal(state.collection.documents.get(personA)?.status, "active");
  });

  it("retries safely across key-store and authoritative-record partial failures", async () => {
    const state = fixture();
    state.collection.failUpdates = true;
    await assert.rejects(
      state.shredder.shred({
        hostedPersonIdentityId: personA,
        completedAt: shreddedAt,
      }),
      /wrapped-key store unavailable/,
    );
    assert.equal(state.authority.shredded.has(personA), false);

    state.collection.failUpdates = false;
    state.authority.failRecordOnce = true;
    await assert.rejects(
      state.shredder.shred({
        hostedPersonIdentityId: personA,
        completedAt: shreddedAt,
      }),
      /identity store unavailable/,
    );
    assert.equal(state.collection.documents.get(personA)?.status, "crypto_shredded");

    await state.shredder.shred({
      hostedPersonIdentityId: personA,
      completedAt: shreddedAt,
    });
    assert.equal(state.authority.shredded.get(personA), shreddedAt);
  });

  it("re-shreds stale wrapped keys replayed by a backup restore", async () => {
    const state = fixture();
    state.authority.shredded.set(personA, shreddedAt);
    state.authority.shredded.set(personB, shreddedAt);
    state.collection.restoreActive(personA);
    state.collection.restoreActive(personB);

    assert.equal(await state.shredder.reconcileRestoredKeys(1), 2);
    assert.equal(state.collection.documents.get(personA)?.status, "crypto_shredded");
    assert.equal(state.collection.documents.get(personB)?.status, "crypto_shredded");
    assert.equal(
      "wrappedDekCiphertext" in (state.collection.documents.get(personA) ?? {}),
      false,
    );
  });
});
