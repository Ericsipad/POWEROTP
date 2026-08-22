import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { HostedAuthIdentityDataMode } from "@powerotp/contracts";

import type { HostedAuthEncryptedFieldEnvelope } from "./hosted-auth-identity-encryption.js";
import {
  HostedAuthIdentityCreationSaga,
  type HostedAuthIdentitySagaRepository,
  type PendingHostedIdentity,
} from "./hosted-auth-identity-saga.js";
import type {
  HostedAuthLookupDigest,
  HostedAuthLookupPurpose,
} from "./hosted-auth-keyed-derivation.js";

type WriteInput = Parameters<HostedAuthIdentitySagaRepository["createPending"]>[0];

class MemoryDerivation {
  versions = [1];
  calls: Array<{ purpose: HostedAuthLookupPurpose; value: string }> = [];

  async deriveLookupCandidates(input: {
    purpose: HostedAuthLookupPurpose;
    canonicalLookupValue: string;
  }): Promise<HostedAuthLookupDigest[]> {
    this.calls.push({ purpose: input.purpose, value: input.canonicalLookupValue });
    return this.versions.map((keyVersion) => ({
      purpose: input.purpose,
      keyVersion,
      digest: createHash("sha256")
        .update(`${input.purpose}:${keyVersion}:${input.canonicalLookupValue}`)
        .digest("base64url"),
    }));
  }
}

class MemoryEncryption {
  readonly keys = new Set<string>();
  readonly plaintexts: string[] = [];
  compensationCalls = 0;
  failCompensation = false;

  async encryptField(input: {
    hostedPersonIdentityId: string;
    fieldName: "email" | "phone" | "derived_date_of_birth";
    schemaVersion: number;
    purpose: string;
    plaintext: string;
  }): Promise<HostedAuthEncryptedFieldEnvelope> {
    this.keys.add(input.hostedPersonIdentityId);
    this.plaintexts.push(input.plaintext);
    return {
      schemaVersion: input.schemaVersion,
      fieldName: input.fieldName,
      purpose: input.purpose,
      keyVersion: 1,
      nonce: Buffer.alloc(12, 1).toString("base64url"),
      ciphertext: Buffer.from(`encrypted:${input.plaintext}`).toString("base64url"),
      authenticationTag: Buffer.alloc(16, 2).toString("base64url"),
    };
  }

  async compensatePendingIdentityKey(hostedPersonIdentityId: string) {
    this.compensationCalls += 1;
    if (this.failCompensation) throw new Error("key compensation failed");
    this.keys.delete(hostedPersonIdentityId);
  }
}

class MemoryRepository implements HostedAuthIdentitySagaRepository {
  readonly writes: WriteInput[] = [];
  readonly identities = new Map<string, PendingHostedIdentity>();
  failCreate = false;
  raceWinner?: PendingHostedIdentity;

  async findByLookupCandidates(input: {
    identityDataMode: HostedAuthIdentityDataMode;
    channel: "email" | "phone";
    candidates: readonly HostedAuthLookupDigest[];
  }) {
    for (const candidate of input.candidates) {
      const identity = this.identities.get(this.key(input, candidate));
      if (identity) {
        return {
          hostedPersonIdentityId: identity.hostedPersonIdentityId,
          hostedAuthProfileId: identity.hostedAuthProfileId,
        };
      }
    }
    return null;
  }

  async createPending(
    input: WriteInput,
    candidates: readonly HostedAuthLookupDigest[],
  ): Promise<PendingHostedIdentity> {
    this.writes.push(structuredClone(input));
    if (this.failCreate) throw new Error("contact insert failed");
    if (this.raceWinner) return this.raceWinner;
    const identity = {
      outcome: "created",
      hostedPersonIdentityId: input.hostedPersonIdentityId,
      hostedAuthProfileId: input.hostedAuthProfileId,
      identityDataMode: input.identityDataMode,
      channel: input.channel,
    } as const;
    this.identities.set(this.key(input, input.lookup), identity);
    for (const candidate of candidates) {
      if (candidate.digest === input.lookup.digest) {
        this.identities.set(this.key(input, candidate), identity);
      }
    }
    return identity;
  }

  private key(
    input: {
      identityDataMode: HostedAuthIdentityDataMode;
      channel: "email" | "phone";
    },
    lookup: HostedAuthLookupDigest,
  ) {
    return `${input.identityDataMode}:${input.channel}:${lookup.keyVersion}:${lookup.digest}`;
  }
}

function fixture() {
  const repository = new MemoryRepository();
  const encryption = new MemoryEncryption();
  const derivation = new MemoryDerivation();
  return {
    repository,
    encryption,
    derivation,
    saga: new HostedAuthIdentityCreationSaga(
      repository,
      encryption,
      derivation,
      () => new Date("2026-08-22T02:15:00.000Z"),
    ),
  };
}

describe("hosted-auth person/profile/contact creation saga", () => {
  it("creates one pending POWEROTP-custody identity with encrypted contact", async () => {
    const state = fixture();
    const result = await state.saga.createPending({
      identityDataMode: "powerotp_pii",
      channel: "email",
      contact: " Person@Example.Test ",
    });

    assert.equal(result.outcome, "created");
    assert.match(result.hostedPersonIdentityId, /^hpi_/);
    assert.match(result.hostedAuthProfileId, /^hap_/);
    assert.deepEqual(state.derivation.calls, [
      { purpose: "powerotp_pii_email", value: "person@example.test" },
    ]);
    assert.deepEqual(state.encryption.plaintexts, ["person@example.test"]);
    assert.equal(state.encryption.keys.size, 1);
    assert.equal(state.repository.writes[0]?.maskedDestination, "p***@example.test");
    assert.ok(state.repository.writes[0]?.encryptedAttribute);
    assert.equal(state.repository.writes[0]?.diditContactReference, undefined);
  });

  it("idempotently reuses the existing mode contact without new PII encryption", async () => {
    const state = fixture();
    const input = {
      identityDataMode: "powerotp_pii",
      channel: "email",
      contact: "person@example.test",
    } as const;
    const first = await state.saga.createPending(input);
    const second = await state.saga.createPending(input);

    assert.equal(second.outcome, "existing");
    assert.equal(second.hostedPersonIdentityId, first.hostedPersonIdentityId);
    assert.equal(second.hostedAuthProfileId, first.hostedAuthProfileId);
    assert.equal(state.repository.writes.length, 1);
    assert.equal(state.encryption.plaintexts.length, 1);
  });

  it("prevents rotation duplicates without merging equal contacts across custody modes", async () => {
    const state = fixture();
    const powerotp = await state.saga.createPending({
      identityDataMode: "powerotp_pii",
      channel: "email",
      contact: "person@example.test",
    });
    state.derivation.versions = [2, 1];
    const rotated = await state.saga.createPending({
      identityDataMode: "powerotp_pii",
      channel: "email",
      contact: "person@example.test",
    });
    const didit = await state.saga.createPending({
      identityDataMode: "didit_pii",
      channel: "email",
      contact: "person@example.test",
      diditContactReference: "didit-contact-123",
    });

    assert.equal(rotated.hostedPersonIdentityId, powerotp.hostedPersonIdentityId);
    assert.equal(rotated.outcome, "existing");
    assert.equal(didit.outcome, "created");
    assert.notEqual(didit.hostedPersonIdentityId, powerotp.hostedPersonIdentityId);
    assert.equal(state.repository.writes[1]?.encryptedAttribute, undefined);
    assert.equal(
      state.repository.writes[1]?.diditContactReference,
      "didit-contact-123",
    );
    assert.equal(state.encryption.plaintexts.length, 1);
  });

  it("rolls back the pending wrapped key after a partial database failure", async () => {
    const state = fixture();
    state.repository.failCreate = true;

    await assert.rejects(
      state.saga.createPending({
        identityDataMode: "powerotp_pii",
        channel: "phone",
        contact: "+15555550123",
      }),
      /contact insert failed/,
    );
    assert.equal(state.encryption.keys.size, 0);
    assert.equal(state.encryption.compensationCalls, 1);
    assert.equal(state.repository.identities.size, 0);
  });

  it("compensates a concurrent loser and returns the canonical identity", async () => {
    const state = fixture();
    state.repository.raceWinner = {
      outcome: "existing",
      hostedPersonIdentityId: `hpi_${"A".repeat(43)}`,
      hostedAuthProfileId: `hap_${"A".repeat(43)}`,
      identityDataMode: "powerotp_pii",
      channel: "email",
    };

    const result = await state.saga.createPending({
      identityDataMode: "powerotp_pii",
      channel: "email",
      contact: "person@example.test",
    });

    assert.equal(result, state.repository.raceWinner);
    assert.equal(state.encryption.keys.size, 0);
    assert.equal(state.encryption.compensationCalls, 1);
  });

  it("surfaces compensation failure instead of hiding an orphaned key", async () => {
    const state = fixture();
    state.repository.failCreate = true;
    state.encryption.failCompensation = true;

    await assert.rejects(
      state.saga.createPending({
        identityDataMode: "powerotp_pii",
        channel: "email",
        contact: "person@example.test",
      }),
      (error: unknown) =>
        error instanceof AggregateError &&
        error.errors.length === 2 &&
        /creation and compensation failed/.test(error.message),
    );
    assert.equal(state.encryption.keys.size, 1);
  });
});
