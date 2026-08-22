import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  HostedAuthDeletionCandidate,
  HostedAuthDeletionEvidenceDisposition,
  HostedAuthIdentityDeletionRepository,
} from "./hosted-auth-identity-deletion-contracts.js";

type Executor = Pick<PoolClient, "query">;
type IdentityRow = QueryResultRow & {
  status: string;
  deletionRequestedAt: Date | null;
  deletionEligibleAt: Date | null;
  potpDiditId: string | null;
  diditInternalId: string | null;
};

export class PostgresHostedAuthIdentityDeletionRepository
  implements HostedAuthIdentityDeletionRepository
{
  constructor(private readonly pool: Pick<Pool, "connect" | "query">) {}

  async schedule(input: {
    hostedPersonIdentityId: string;
    requestedAt: Date;
    eligibleAt: Date;
  }): Promise<"scheduled" | "duplicate" | "completed"> {
    requireDate(input.requestedAt);
    requireDate(input.eligibleAt);
    if (input.eligibleAt < input.requestedAt) {
      throw new Error("Hosted-auth deletion eligibility cannot precede its request");
    }
    return this.inTransaction((client) =>
      this.scheduleWith(client, input, false),
    );
  }

  async scheduleAbandonedProviderIdentity(input: {
    hostedPersonIdentityId: string;
    requestedAt: Date;
  }): Promise<"scheduled" | "duplicate" | "completed"> {
    requireDate(input.requestedAt);
    return this.inTransaction((client) =>
      this.scheduleWith(
        client,
        {
          hostedPersonIdentityId: input.hostedPersonIdentityId,
          requestedAt: input.requestedAt,
          eligibleAt: input.requestedAt,
        },
        true,
      ),
    );
  }

  async claimEligible(input: {
    now: Date;
    leaseExpiredBefore: Date;
    limit: number;
  }): Promise<readonly HostedAuthDeletionCandidate[]> {
    requireDate(input.now);
    requireDate(input.leaseExpiredBefore);
    requireLimit(input.limit);
    const result = await this.pool.query<
      QueryResultRow & {
        personId: string;
        potpDiditId: string | null;
        diditInternalId: string | null;
        contactReferences: string[];
      }
    >(
      `with candidates as (
         select person_id
           from hosted_auth.person_identities
          where status = 'deleting'
            and deletion_eligible_at <= $1
            and (deletion_claimed_at is null or deletion_claimed_at < $2)
          order by deletion_eligible_at, person_id
          for update skip locked
          limit $3
       )
       update hosted_auth.person_identities p
          set deletion_claimed_at = $1, updated_at = $1
         from candidates c
        where p.person_id = c.person_id and p.status = 'deleting'
       returning p.person_id as "personId", p.potp_didit_id as "potpDiditId",
                 p.didit_internal_id::text as "diditInternalId",
                 array(select distinct c2.didit_contact_reference
                         from hosted_auth.contacts c2
                         join hosted_auth.auth_profiles ap on ap.profile_id = c2.profile_id
                        where ap.person_id = p.person_id
                          and c2.didit_contact_reference is not null
                        order by c2.didit_contact_reference) as "contactReferences"`,
      [input.now, input.leaseExpiredBefore, input.limit],
    );
    return result.rows.map((row) => ({
      hostedPersonIdentityId: row.personId,
      providerIdentityReferences: [
        ...(row.potpDiditId ? [row.potpDiditId] : []),
        ...(row.diditInternalId ? [row.diditInternalId] : []),
      ],
      providerContactReferences: row.contactReferences,
    }));
  }

  async finalize(input: {
    hostedPersonIdentityId: string;
    completedAt: Date;
    providerCleanupConfirmed: boolean;
    evidence: HostedAuthDeletionEvidenceDisposition;
  }): Promise<"completed" | "duplicate"> {
    requireDate(input.completedAt);
    return this.inTransaction(async (client) => {
      const identity = await this.lockIdentity(
        client,
        input.hostedPersonIdentityId,
      );
      if (!identity) throw new Error("Hosted-auth identity is unavailable");
      if (identity.status === "deleted") return "duplicate";
      if (identity.status !== "deleting") {
        throw new Error("Hosted-auth identity is not blocked for deletion");
      }
      if (
        (identity.potpDiditId || identity.diditInternalId) &&
        !input.providerCleanupConfirmed
      ) {
        throw new Error("Provider cleanup must be durably confirmed");
      }

      const profileIds =
        "select profile_id from hosted_auth.auth_profiles where person_id = $1";
      await client.query(
        `delete from hosted_auth.webauthn_credentials where profile_id in (${profileIds})`,
        [input.hostedPersonIdentityId],
      );
      await client.query(
        `delete from hosted_auth.contacts where profile_id in (${profileIds})`,
        [input.hostedPersonIdentityId],
      );
      await client.query(
        `delete from hosted_auth.encrypted_identity_attributes where profile_id in (${profileIds})`,
        [input.hostedPersonIdentityId],
      );
      if (!input.evidence.retainConsentEvidence) {
        await client.query(
          "delete from hosted_auth.consent_records where person_id = $1",
          [input.hostedPersonIdentityId],
        );
      }
      if (input.evidence.retainVerificationEvidence) {
        await client.query(
          `update hosted_auth.identity_verifications
              set derived_dob_ciphertext = null, derived_dob_nonce = null,
                  derived_dob_authentication_tag = null, derived_dob_key_version = null,
                  provider_operation_reference = null, deleted_at = $2
            where person_id = $1`,
          [input.hostedPersonIdentityId, input.completedAt],
        );
      } else {
        await client.query(
          "delete from hosted_auth.identity_verifications where person_id = $1",
          [input.hostedPersonIdentityId],
        );
      }
      await client.query(
        `update hosted_auth.auth_profiles
            set status = 'deleted', contact_status = 'revoked',
                deleted_at = $2, updated_at = $2
          where person_id = $1`,
        [input.hostedPersonIdentityId, input.completedAt],
      );
      await client.query(
        `update hosted_auth.person_identities
            set status = 'deleted', potp_didit_id = null, didit_internal_id = null,
                passport_identity_id = null, deleted_at = $2, updated_at = $2
          where person_id = $1 and status = 'deleting'`,
        [input.hostedPersonIdentityId, input.completedAt],
      );
      return "completed";
    });
  }

  private async scheduleWith(
    client: Executor,
    input: {
      hostedPersonIdentityId: string;
      requestedAt: Date;
      eligibleAt: Date;
    },
    requirePendingProviderReference: boolean,
  ): Promise<"scheduled" | "duplicate" | "completed"> {
    const identity = await this.lockIdentity(
      client,
      input.hostedPersonIdentityId,
    );
    if (!identity) throw new Error("Hosted-auth identity is unavailable");
    if (identity.status === "deleted") return "completed";
    if (identity.status === "deleting") {
      if (
        identity.deletionEligibleAt?.getTime() === input.eligibleAt.getTime()
      ) {
        return "duplicate";
      }
      throw new Error("Conflicting hosted-auth deletion schedule");
    }
    if (requirePendingProviderReference) {
      const providerArtifact = await client.query(
        `select 1
           from hosted_auth.auth_profiles ap
           join hosted_auth.contacts c on c.profile_id = ap.profile_id
          where ap.person_id = $1 and ap.status = 'pending'
            and c.didit_contact_reference is not null
          limit 1`,
        [input.hostedPersonIdentityId],
      );
      if (identity.status !== "pending" || providerArtifact.rows.length === 0) {
        throw new Error("Abandoned provider cleanup is not eligible");
      }
    }
    await client.query(
      `update hosted_auth.person_identities
          set status = 'deleting', deletion_requested_at = $2,
              deletion_eligible_at = $3, deletion_claimed_at = null, updated_at = $2
        where person_id = $1`,
      [input.hostedPersonIdentityId, input.requestedAt, input.eligibleAt],
    );
    await client.query(
      `update hosted_auth.auth_profiles
          set status = 'deleting', contact_status = 'revoked', updated_at = $2
        where person_id = $1`,
      [input.hostedPersonIdentityId, input.requestedAt],
    );
    await client.query(
      `update hosted_auth.webauthn_credentials
          set revoked_at = coalesce(revoked_at, $2)
        where profile_id in (
          select profile_id from hosted_auth.auth_profiles where person_id = $1
        )`,
      [input.hostedPersonIdentityId, input.requestedAt],
    );
    await client.query(
      `update hosted_auth.contacts
          set status = 'revoked', verified_at = null, updated_at = $2
        where profile_id in (
          select profile_id from hosted_auth.auth_profiles where person_id = $1
        )`,
      [input.hostedPersonIdentityId, input.requestedAt],
    );
    return "scheduled";
  }

  private async lockIdentity(
    client: Executor,
    hostedPersonIdentityId: string,
  ): Promise<IdentityRow | null> {
    const result = await client.query<IdentityRow>(
      `select status, deletion_requested_at as "deletionRequestedAt",
              deletion_eligible_at as "deletionEligibleAt",
              potp_didit_id as "potpDiditId",
              didit_internal_id::text as "diditInternalId"
         from hosted_auth.person_identities
        where person_id = $1 for update`,
      [hostedPersonIdentityId],
    );
    return result.rows[0] ?? null;
  }

  private async inTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function requireDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new Error("A valid hosted-auth deletion timestamp is required");
  }
}

function requireLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Hosted-auth deletion limit must be 1-1000");
  }
}
