import { randomUUID } from "node:crypto";

import {
  hostedAuthRealms,
  type HostedAuthIdentityDataMode,
} from "@powerotp/contracts";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  ExistingHostedIdentity,
  HostedAuthIdentitySagaRepository,
  PendingHostedIdentity,
  PendingHostedIdentityWrite,
} from "./hosted-auth-identity-saga.js";
import type { HostedAuthLookupDigest } from "./hosted-auth-keyed-derivation.js";

type QueryExecutor = Pick<PoolClient, "query">;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export class PostgresHostedAuthIdentitySagaRepository
  implements HostedAuthIdentitySagaRepository
{
  constructor(private readonly pool: Pick<Pool, "connect" | "query">) {}

  async findByLookupCandidates(input: {
    identityDataMode: HostedAuthIdentityDataMode;
    channel: "email" | "phone";
    candidates: readonly HostedAuthLookupDigest[];
  }): Promise<ExistingHostedIdentity | null> {
    return this.findWith(this.pool, input);
  }

  async createPending(
    input: PendingHostedIdentityWrite,
    candidates: readonly HostedAuthLookupDigest[],
  ): Promise<PendingHostedIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await this.findWith(client, {
        identityDataMode: input.identityDataMode,
        channel: input.channel,
        candidates,
      });
      if (existing) {
        await client.query("commit");
        return { outcome: "existing", ...existing, ...this.scope(input) };
      }

      await this.insertPending(client, input);
      await client.query("commit");
      return { outcome: "created", ...this.identity(input), ...this.scope(input) };
    } catch (error) {
      await client.query("rollback");
      if (isUniqueViolation(error)) {
        const existing = await this.findByLookupCandidates({
          identityDataMode: input.identityDataMode,
          channel: input.channel,
          candidates,
        });
        if (existing) {
          return { outcome: "existing", ...existing, ...this.scope(input) };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertPending(
    client: QueryExecutor,
    input: PendingHostedIdentityWrite,
  ): Promise<void> {
    await client.query(
      `insert into hosted_auth.person_identities
        (person_id, status, schema_version, created_at, updated_at)
       values ($1, 'pending', 1, $2, $2)`,
      [input.hostedPersonIdentityId, input.createdAt],
    );
    await client.query(
      `insert into hosted_auth.auth_profiles
        (profile_id, person_id, identity_data_mode, rp_id, webauthn_user_handle,
         contact_status, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'pending', 'pending', $6, $6)`,
      [
        input.hostedAuthProfileId,
        input.hostedPersonIdentityId,
        input.identityDataMode,
        hostedAuthRealms[input.identityDataMode].rpId,
        input.webauthnUserHandle,
        input.createdAt,
      ],
    );

    if (input.encryptedAttribute) {
      const envelope = input.encryptedAttribute.envelope;
      await client.query(
        `insert into hosted_auth.encrypted_identity_attributes
          (attribute_id, profile_id, identity_data_mode, attribute_type,
           ciphertext, nonce, authentication_tag, key_version,
           encryption_purpose, verification_status, created_at, updated_at)
         values ($1, $2, 'powerotp_pii', $3, $4, $5, $6, $7, $8,
                 'pending', $9, $9)`,
        [
          input.encryptedAttribute.attributeId,
          input.hostedAuthProfileId,
          input.channel,
          Buffer.from(envelope.ciphertext, "base64url"),
          Buffer.from(envelope.nonce, "base64url"),
          Buffer.from(envelope.authenticationTag, "base64url"),
          envelope.keyVersion,
          envelope.purpose,
          input.createdAt,
        ],
      );
    }

    await client.query(
      `insert into hosted_auth.contacts
        (contact_id, profile_id, identity_data_mode, channel, lookup_hash,
         lookup_key_version, encrypted_attribute_id, didit_contact_reference,
         masked_destination, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $10)`,
      [
        randomUUID(),
        input.hostedAuthProfileId,
        input.identityDataMode,
        input.channel,
        Buffer.from(input.lookup.digest, "base64url"),
        input.lookup.keyVersion,
        input.encryptedAttribute?.attributeId ?? null,
        input.diditContactReference ?? null,
        input.maskedDestination,
        input.createdAt,
      ],
    );
  }

  private async findWith(
    executor: QueryExecutor,
    input: {
      identityDataMode: HostedAuthIdentityDataMode;
      channel: "email" | "phone";
      candidates: readonly HostedAuthLookupDigest[];
    },
  ): Promise<ExistingHostedIdentity | null> {
    if (input.candidates.length === 0) {
      throw new Error("At least one hosted-auth lookup candidate is required");
    }
    const parameters: unknown[] = [input.identityDataMode, input.channel];
    const candidateClauses = input.candidates.map((candidate) => {
      parameters.push(
        candidate.keyVersion,
        Buffer.from(candidate.digest, "base64url"),
      );
      return `(c.lookup_key_version = $${parameters.length - 1} and c.lookup_hash = $${parameters.length})`;
    });
    const result = await executor.query<
      QueryResultRow & ExistingHostedIdentity
    >(
      `select p.person_id as "hostedPersonIdentityId",
              ap.profile_id as "hostedAuthProfileId"
         from hosted_auth.contacts c
         join hosted_auth.auth_profiles ap on ap.profile_id = c.profile_id
         join hosted_auth.person_identities p on p.person_id = ap.person_id
        where c.identity_data_mode = $1
          and c.channel = $2
          and (${candidateClauses.join(" or ")})
        limit 1`,
      parameters,
    );
    return result.rows[0] ?? null;
  }

  private identity(
    input: PendingHostedIdentityWrite,
  ): ExistingHostedIdentity {
    return {
      hostedPersonIdentityId: input.hostedPersonIdentityId,
      hostedAuthProfileId: input.hostedAuthProfileId,
    };
  }

  private scope(input: PendingHostedIdentityWrite) {
    return {
      identityDataMode: input.identityDataMode,
      channel: input.channel,
    } as const;
  }
}
