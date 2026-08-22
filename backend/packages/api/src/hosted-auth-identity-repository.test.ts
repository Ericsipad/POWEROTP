import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Pool } from "pg";

import { PostgresHostedAuthIdentitySagaRepository } from "./hosted-auth-identity-repository.js";
import type { PendingHostedIdentityWrite } from "./hosted-auth-identity-saga.js";
import type { HostedAuthLookupDigest } from "./hosted-auth-keyed-derivation.js";

const createdAt = new Date("2026-08-22T02:15:00.000Z");
const lookup = {
  purpose: "powerotp_pii_email",
  keyVersion: 2,
  digest: Buffer.alloc(32, 4).toString("base64url"),
} as const satisfies HostedAuthLookupDigest;
const write = {
  hostedPersonIdentityId: `hpi_${"A".repeat(43)}`,
  hostedAuthProfileId: `hap_${"A".repeat(43)}`,
  webauthnUserHandle: Buffer.alloc(32, 3),
  identityDataMode: "powerotp_pii",
  channel: "email",
  lookup,
  maskedDestination: "p***@example.test",
  encryptedAttribute: {
    attributeId: "b5d03c90-8104-4ab3-83d8-f4c141eac828",
    envelope: {
      schemaVersion: 1,
      fieldName: "email",
      purpose: "contact_authentication",
      keyVersion: 1,
      nonce: Buffer.alloc(12, 1).toString("base64url"),
      ciphertext: Buffer.from("ciphertext").toString("base64url"),
      authenticationTag: Buffer.alloc(16, 2).toString("base64url"),
    },
  },
  createdAt,
} as const satisfies PendingHostedIdentityWrite;

function fakePool(input?: { failContactInsert?: boolean }) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let released = false;
  const query = async (text: string, values?: unknown[]) => {
    queries.push({ text, values });
    if (input?.failContactInsert && text.includes("insert into hosted_auth.contacts")) {
      throw new Error("contact insert failed");
    }
    return { rows: [] };
  };
  const client = { query, release: () => void (released = true) };
  const pool = {
    query,
    async connect() {
      return client;
    },
  } as unknown as Pick<Pool, "connect" | "query">;
  return { pool, queries, released: () => released };
}

describe("Postgres hosted-auth identity saga repository", () => {
  it("atomically writes the person, realm profile, encrypted attribute, and contact", async () => {
    const fake = fakePool();
    const repository = new PostgresHostedAuthIdentitySagaRepository(fake.pool);

    const result = await repository.createPending(write, [lookup]);

    assert.equal(result.outcome, "created");
    assert.deepEqual(
      fake.queries.map(({ text }) => text.trim().split(/\s+/).slice(0, 3).join(" ")),
      [
        "begin",
        "select p.person_id as",
        "insert into hosted_auth.person_identities",
        "insert into hosted_auth.auth_profiles",
        "insert into hosted_auth.encrypted_identity_attributes",
        "insert into hosted_auth.contacts",
        "commit",
      ],
    );
    const profileInsert = fake.queries[3]?.values;
    assert.equal(profileInsert?.[3], "authx.powerotp.com");
    const contactInsert = fake.queries[5]?.values;
    assert.equal(contactInsert?.[5], 2);
    assert.equal(contactInsert?.[6], write.encryptedAttribute.attributeId);
    assert.equal(contactInsert?.[7], null);
    assert.equal(fake.released(), true);
  });

  it("rolls back every Supabase row when contact insertion fails", async () => {
    const fake = fakePool({ failContactInsert: true });
    const repository = new PostgresHostedAuthIdentitySagaRepository(fake.pool);

    await assert.rejects(
      repository.createPending(write, [lookup]),
      /contact insert failed/,
    );

    assert.equal(
      fake.queries.some(({ text }) => text === "rollback"),
      true,
    );
    assert.equal(
      fake.queries.some(({ text }) => text === "commit"),
      false,
    );
    assert.equal(fake.released(), true);
  });
});
