import type { Pool, PoolClient, QueryResultRow } from "pg";

export type PendingHostedIdentityProfileArtifact = Readonly<{
  hostedAuthProfileId: string;
  identityDataMode: "powerotp_pii" | "didit_pii";
  rpId: string;
  profileStatus: string;
  contactStatus: string;
  contactCount: number;
  encryptedAttributeCount: number;
  validCustodyContactCount: number;
  providerReferenceCount: number;
  credentialCount: number;
  consentCount: number;
}>;

export type PendingHostedIdentityArtifact = Readonly<{
  hostedPersonIdentityId: string;
  personStatus: string;
  verificationCount: number;
  profiles: readonly PendingHostedIdentityProfileArtifact[];
}>;

export interface HostedAuthIdentityReconciliationRepository {
  claimStalePending(input: {
    staleBefore: Date;
    claimedAt: Date;
    limit: number;
  }): Promise<readonly string[]>;
  inspect(hostedPersonIdentityId: string): Promise<PendingHostedIdentityArtifact | null>;
  personExists(hostedPersonIdentityId: string): Promise<boolean>;
  deletePending(hostedPersonIdentityId: string): Promise<boolean>;
}

type Executor = Pick<PoolClient, "query">;

type ArtifactRow = QueryResultRow & {
  personId: string;
  personStatus: string;
  verificationCount: number;
  profileId: string | null;
  identityDataMode: "powerotp_pii" | "didit_pii" | null;
  rpId: string | null;
  profileStatus: string | null;
  contactStatus: string | null;
  contactCount: number;
  encryptedAttributeCount: number;
  validCustodyContactCount: number;
  providerReferenceCount: number;
  credentialCount: number;
  consentCount: number;
};

export class PostgresHostedAuthIdentityReconciliationRepository
  implements HostedAuthIdentityReconciliationRepository
{
  constructor(private readonly pool: Pick<Pool, "connect" | "query">) {}

  async claimStalePending(input: {
    staleBefore: Date;
    claimedAt: Date;
    limit: number;
  }): Promise<readonly string[]> {
    requireDate(input.staleBefore);
    requireDate(input.claimedAt);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new Error("Hosted-auth reconciliation limit must be 1-1000");
    }
    const result = await this.pool.query<QueryResultRow & { personId: string }>(
      `with candidates as (
         select person_id
           from hosted_auth.person_identities
          where status = 'pending' and updated_at < $1
          order by updated_at, person_id
          for update skip locked
          limit $2
       )
       update hosted_auth.person_identities p
          set updated_at = $3
         from candidates c
        where p.person_id = c.person_id and p.status = 'pending'
       returning p.person_id as "personId"`,
      [input.staleBefore, input.limit, input.claimedAt],
    );
    return result.rows.map(({ personId }) => personId);
  }

  async inspect(
    hostedPersonIdentityId: string,
  ): Promise<PendingHostedIdentityArtifact | null> {
    const result = await this.pool.query<ArtifactRow>(
      `select p.person_id as "personId", p.status as "personStatus",
              (select count(*)::int from hosted_auth.identity_verifications v
                where v.person_id = p.person_id) as "verificationCount",
              ap.profile_id as "profileId", ap.identity_data_mode as "identityDataMode",
              ap.rp_id as "rpId", ap.status as "profileStatus",
              ap.contact_status as "contactStatus",
              (select count(*)::int from hosted_auth.contacts c
                where c.profile_id = ap.profile_id) as "contactCount",
              (select count(*)::int from hosted_auth.encrypted_identity_attributes a
                where a.profile_id = ap.profile_id) as "encryptedAttributeCount",
              (select count(*)::int
                 from hosted_auth.contacts c
                 left join hosted_auth.encrypted_identity_attributes a
                   on a.attribute_id = c.encrypted_attribute_id
                  and a.profile_id = c.profile_id
                where c.profile_id = ap.profile_id
                  and c.identity_data_mode = ap.identity_data_mode
                  and (
                    (ap.identity_data_mode = 'powerotp_pii'
                      and a.attribute_id is not null
                      and a.attribute_type = c.channel
                      and c.didit_contact_reference is null)
                    or
                    (ap.identity_data_mode = 'didit_pii'
                      and c.encrypted_attribute_id is null
                      and c.didit_contact_reference is not null)
                  )) as "validCustodyContactCount",
              (select count(*)::int from hosted_auth.contacts c
                where c.profile_id = ap.profile_id
                  and c.didit_contact_reference is not null) as "providerReferenceCount",
              (select count(*)::int from hosted_auth.webauthn_credentials w
                where w.profile_id = ap.profile_id) as "credentialCount",
              (select count(*)::int from hosted_auth.consent_records cr
                where cr.profile_id = ap.profile_id) as "consentCount"
         from hosted_auth.person_identities p
         left join hosted_auth.auth_profiles ap on ap.person_id = p.person_id
        where p.person_id = $1
        order by ap.profile_id`,
      [hostedPersonIdentityId],
    );
    const first = result.rows[0];
    if (!first) return null;
    return {
      hostedPersonIdentityId: first.personId,
      personStatus: first.personStatus,
      verificationCount: first.verificationCount,
      profiles: result.rows.flatMap((row) =>
        row.profileId &&
        row.identityDataMode &&
        row.rpId &&
        row.profileStatus &&
        row.contactStatus
          ? [
              {
                hostedAuthProfileId: row.profileId,
                identityDataMode: row.identityDataMode,
                rpId: row.rpId,
                profileStatus: row.profileStatus,
                contactStatus: row.contactStatus,
                contactCount: row.contactCount,
                encryptedAttributeCount: row.encryptedAttributeCount,
                validCustodyContactCount: row.validCustodyContactCount,
                providerReferenceCount: row.providerReferenceCount,
                credentialCount: row.credentialCount,
                consentCount: row.consentCount,
              },
            ]
          : [],
      ),
    };
  }

  async personExists(hostedPersonIdentityId: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from hosted_auth.person_identities where person_id = $1`,
      [hostedPersonIdentityId],
    );
    return result.rows.length > 0;
  }

  async deletePending(hostedPersonIdentityId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const locked = await client.query<QueryResultRow & { status: string }>(
        `select status from hosted_auth.person_identities
          where person_id = $1 for update`,
        [hostedPersonIdentityId],
      );
      if (locked.rows[0]?.status !== "pending") {
        await client.query("rollback");
        return false;
      }
      await this.deletePendingRows(client, hostedPersonIdentityId);
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async deletePendingRows(
    client: Executor,
    hostedPersonIdentityId: string,
  ): Promise<void> {
    const profileIds =
      `select profile_id from hosted_auth.auth_profiles where person_id = $1`;
    await client.query(
      `delete from hosted_auth.contacts where profile_id in (${profileIds})`,
      [hostedPersonIdentityId],
    );
    await client.query(
      `delete from hosted_auth.encrypted_identity_attributes
        where profile_id in (${profileIds})`,
      [hostedPersonIdentityId],
    );
    await client.query(
      `delete from hosted_auth.auth_profiles
        where person_id = $1 and status = 'pending'`,
      [hostedPersonIdentityId],
    );
    const deleted = await client.query(
      `delete from hosted_auth.person_identities
        where person_id = $1 and status = 'pending'`,
      [hostedPersonIdentityId],
    );
    if (deleted.rowCount !== 1) {
      throw new Error("Pending hosted-auth identity cleanup was not atomic");
    }
  }
}

function requireDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new Error("A valid hosted-auth reconciliation timestamp is required");
  }
}
