import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import {
  DecryptCommand,
  EncryptCommand,
  type KMSClient,
} from "@aws-sdk/client-kms";
import type { Collection, Db } from "mongodb";

import {
  WrappedIdentityKeyRepository,
  WRAPPED_IDENTITY_KEYS_COLLECTION_NAME,
} from "./hosted-auth-durable-repository.js";
import type {
  WrappedIdentityKeyDocument,
} from "./hosted-auth-durable-schemas.js";
import {
  AwsKmsHostedAuthIdentityKeyAuthority,
  HostedAuthIdentityEncryptionService,
  type HostedAuthIdentityKeyAuthority,
} from "./hosted-auth-identity-encryption.js";

const personA = `hpi_${"A".repeat(43)}`;
const personB = `hpi_${"B".repeat(42)}A`;

class MemoryWrappedKeyCollection {
  readonly documents = new Map<string, WrappedIdentityKeyDocument>();

  async findOne(filter: { _id: string; status?: string }) {
    const document = this.documents.get(filter._id);
    if (!document || (filter.status && document.status !== filter.status)) {
      return null;
    }
    return structuredClone(document);
  }

  async updateOne(
    filter: { _id: string },
    update: { $setOnInsert: WrappedIdentityKeyDocument },
  ) {
    if (this.documents.has(filter._id)) {
      return { acknowledged: true, upsertedCount: 0 };
    }
    this.documents.set(filter._id, structuredClone(update.$setOnInsert));
    return { acknowledged: true, upsertedCount: 1 };
  }
}

class MemoryKeyAuthority implements HostedAuthIdentityKeyAuthority {
  readonly kmsKeyVersion = "kek_v1";
  readonly wrapped = new Map<string, { person: string; dek: Uint8Array }>();
  wrapCalls = 0;
  denyWrap = false;
  denyUnwrap = false;

  async wrapDek(input: {
    hostedPersonIdentityId: string;
    plaintextDek: Uint8Array;
  }) {
    if (this.denyWrap) throw new Error("KMS encrypt denied");
    this.wrapCalls += 1;
    const ciphertext = randomBytes(48).toString("base64url");
    this.wrapped.set(ciphertext, {
      person: input.hostedPersonIdentityId,
      dek: Uint8Array.from(input.plaintextDek),
    });
    return ciphertext;
  }

  async unwrapDek(input: {
    hostedPersonIdentityId: string;
    wrappedDekCiphertext: string;
  }) {
    if (this.denyUnwrap) throw new Error("KMS decrypt denied");
    const wrapped = this.wrapped.get(input.wrappedDekCiphertext);
    if (!wrapped || wrapped.person !== input.hostedPersonIdentityId) {
      throw new Error("KMS encryption-context mismatch");
    }
    return Uint8Array.from(wrapped.dek);
  }
}

function testService(input?: {
  collection?: MemoryWrappedKeyCollection;
  authority?: MemoryKeyAuthority;
}) {
  const collection = input?.collection ?? new MemoryWrappedKeyCollection();
  const authority = input?.authority ?? new MemoryKeyAuthority();
  const repository = new WrappedIdentityKeyRepository(
    {} as Db,
    collection as unknown as Collection<WrappedIdentityKeyDocument>,
  );
  return {
    authority,
    collection,
    repository,
    service: new HostedAuthIdentityEncryptionService(repository, authority),
  };
}

describe("hosted-auth per-person envelope encryption", () => {
  it("persists one wrapped DEK per person and decrypts after service restart", async () => {
    const fixture = testService();
    const email = await fixture.service.encryptField({
      hostedPersonIdentityId: personA,
      fieldName: "email",
      schemaVersion: 1,
      purpose: "contact_authentication",
      plaintext: "person@example.test",
    });
    await fixture.service.encryptField({
      hostedPersonIdentityId: personA,
      fieldName: "phone",
      schemaVersion: 1,
      purpose: "account_recovery",
      plaintext: "+15555550123",
    });

    assert.equal(fixture.authority.wrapCalls, 1);
    assert.equal(fixture.collection.documents.size, 1);
    const persisted = fixture.collection.documents.get(personA);
    assert.equal(persisted?._id, personA);
    assert.equal(persisted?.status, "active");
    assert.equal("plaintextDek" in (persisted ?? {}), false);
    assert.equal(JSON.stringify(persisted).includes("person@example.test"), false);
    assert.equal("wrappedDekCiphertext" in email, false);

    const restarted = new HostedAuthIdentityEncryptionService(
      fixture.repository,
      fixture.authority,
    );
    assert.equal(
      await restarted.decryptField({
        hostedPersonIdentityId: personA,
        envelope: email,
      }),
      "person@example.test",
    );
  });

  it("rejects person, field, schema-version, purpose, and ciphertext swapping", async () => {
    const fixture = testService();
    const envelopeA = await fixture.service.encryptField({
      hostedPersonIdentityId: personA,
      fieldName: "email",
      schemaVersion: 1,
      purpose: "contact_authentication",
      plaintext: "a@example.test",
    });
    const envelopeB = await fixture.service.encryptField({
      hostedPersonIdentityId: personB,
      fieldName: "email",
      schemaVersion: 1,
      purpose: "contact_authentication",
      plaintext: "b@example.test",
    });

    for (const input of [
      {
        hostedPersonIdentityId: personA,
        envelope: { ...envelopeA, fieldName: "phone" as const },
      },
      {
        hostedPersonIdentityId: personA,
        envelope: { ...envelopeA, schemaVersion: 2 },
      },
      {
        hostedPersonIdentityId: personA,
        envelope: { ...envelopeA, purpose: "account_recovery" },
      },
      {
        hostedPersonIdentityId: personB,
        envelope: {
          ...envelopeB,
          nonce: envelopeA.nonce,
          ciphertext: envelopeA.ciphertext,
          authenticationTag: envelopeA.authenticationTag,
        },
      },
    ]) {
      await assert.rejects(
        fixture.service.decryptField(input),
      );
    }
    await assert.rejects(
      fixture.service.decryptField({
        hostedPersonIdentityId: personB,
        envelope: envelopeA,
      }),
    );
  });

  it("fails closed on KMS denial without persisting a plaintext or wrapped key", async () => {
    const fixture = testService();
    fixture.authority.denyWrap = true;
    await assert.rejects(
      fixture.service.encryptField({
        hostedPersonIdentityId: personA,
        fieldName: "email",
        schemaVersion: 1,
        purpose: "contact_authentication",
        plaintext: "person@example.test",
      }),
      /KMS encrypt denied/,
    );
    assert.equal(fixture.collection.documents.size, 0);

    fixture.authority.denyWrap = false;
    const envelope = await fixture.service.encryptField({
      hostedPersonIdentityId: personA,
      fieldName: "email",
      schemaVersion: 1,
      purpose: "contact_authentication",
      plaintext: "person@example.test",
    });
    fixture.authority.denyUnwrap = true;
    await assert.rejects(
      fixture.service.decryptField({
        hostedPersonIdentityId: personA,
        envelope,
      }),
      /KMS decrypt denied/,
    );
  });

  it("keeps Supabase ciphertext and MongoDB wrapped keys independently insufficient", async () => {
    const collection = new MemoryWrappedKeyCollection();
    const requestedCollections: string[] = [];
    const retentionDb = {
      collection(name: string) {
        requestedCollections.push(name);
        return collection;
      },
    } as unknown as Db;
    const authority = new MemoryKeyAuthority();
    const service = new HostedAuthIdentityEncryptionService(
      new WrappedIdentityKeyRepository(retentionDb),
      authority,
    );
    const supabaseRow = await service.encryptField({
      hostedPersonIdentityId: personA,
      fieldName: "email",
      schemaVersion: 1,
      purpose: "contact_authentication",
      plaintext: "person@example.test",
    });

    assert.deepEqual(requestedCollections, [
      WRAPPED_IDENTITY_KEYS_COLLECTION_NAME,
    ]);
    assert.equal(JSON.stringify(supabaseRow).includes("wrappedDek"), false);
    const mongoDump = [...collection.documents.values()];
    assert.equal(JSON.stringify(mongoDump).includes("person@example.test"), false);

    authority.denyUnwrap = true;
    await assert.rejects(
      service.decryptField({
        hostedPersonIdentityId: personA,
        envelope: supabaseRow,
      }),
      /KMS decrypt denied/,
    );
  });

  it("binds AWS KMS wrapping and unwrapping to person-specific encryption context", async () => {
    const dek = randomBytes(32);
    const commands: Array<EncryptCommand | DecryptCommand> = [];
    const client = {
      async send(command: EncryptCommand | DecryptCommand) {
        commands.push(command);
        return command instanceof EncryptCommand
          ? { CiphertextBlob: randomBytes(48) }
          : { Plaintext: dek };
      },
    } as unknown as KMSClient;
    const authority = new AwsKmsHostedAuthIdentityKeyAuthority({
      keyId: "arn:aws:kms:us-east-1:123456789012:key/example",
      kmsKeyVersion: "kek_v1",
      client,
    });

    const wrapped = await authority.wrapDek({
      hostedPersonIdentityId: personA,
      plaintextDek: dek,
    });
    await authority.unwrapDek({
      hostedPersonIdentityId: personA,
      wrappedDekCiphertext: wrapped,
    });

    assert.equal(commands.length, 2);
    for (const command of commands) {
      assert.deepEqual(command.input.EncryptionContext, {
        hostedPersonIdentityId: personA,
        powerotpPurpose: "hosted_auth_identity_dek",
      });
      assert.equal(command.input.KeyId, "arn:aws:kms:us-east-1:123456789012:key/example");
    }
  });
});
