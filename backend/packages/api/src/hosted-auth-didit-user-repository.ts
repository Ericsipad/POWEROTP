import {
  DiditInternalIdSchema,
  HostedAuthDiditUserResultSchema,
  PotpDiditIdSchema,
  type HostedAuthDiditUserResult,
} from "@powerotp/contracts";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { HostedAuthDiditUserMappingRepository } from "./hosted-auth-didit-user-service.js";

type IdentityRow = QueryResultRow & {
  status: string;
  potpDiditId: string | null;
  diditInternalId: string | null;
};

export class PostgresHostedAuthDiditUserMappingRepository
  implements HostedAuthDiditUserMappingRepository
{
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async reserve(input: {
    hostedPersonIdentityId: string;
    proposedPotpDiditId: string;
    reservedAt: Date;
  }) {
    const proposedPotpDiditId = PotpDiditIdSchema.parse(
      input.proposedPotpDiditId,
    );
    requireDate(input.reservedAt);
    return this.inTransaction(async (client) => {
      const identity = await this.lockIdentity(
        client,
        input.hostedPersonIdentityId,
      );
      this.requireUsable(identity);
      if (identity.diditInternalId) {
        return {
          status: "mapped",
          mapping: this.mapping(identity),
        } as const;
      }
      if (identity.potpDiditId) {
        return {
          status: "reserved",
          potpDiditId: PotpDiditIdSchema.parse(identity.potpDiditId),
        } as const;
      }

      await client.query(
        `update hosted_auth.person_identities
            set potp_didit_id = $2, updated_at = $3
          where person_id = $1 and potp_didit_id is null`,
        [input.hostedPersonIdentityId, proposedPotpDiditId, input.reservedAt],
      );
      return { status: "reserved", potpDiditId: proposedPotpDiditId } as const;
    });
  }

  async completeWithProvider(
    input: {
      hostedPersonIdentityId: string;
      potpDiditId: string;
    },
    createOrResolveProviderUser: () => Promise<
      Readonly<{ mapping: HostedAuthDiditUserResult; completedAt: Date }>
    >,
  ): Promise<HostedAuthDiditUserResult> {
    const potpDiditId = PotpDiditIdSchema.parse(input.potpDiditId);
    return this.inTransaction(async (client) => {
      const identity = await this.lockIdentity(
        client,
        input.hostedPersonIdentityId,
      );
      this.requireUsable(identity);
      if (identity.potpDiditId !== potpDiditId) {
        throw new Error("Didit mapping reservation does not match this person");
      }
      if (identity.diditInternalId) {
        return this.mapping(identity);
      }

      const providerResult = await createOrResolveProviderUser();
      requireDate(providerResult.completedAt);
      const mapping = HostedAuthDiditUserResultSchema.parse(
        providerResult.mapping,
      );
      if (mapping.potpDiditId !== potpDiditId) {
        throw new Error("Didit User result does not match the reserved mapping");
      }

      await client.query(
        `update hosted_auth.person_identities
            set didit_internal_id = $3::uuid, updated_at = $4
          where person_id = $1 and potp_didit_id = $2
            and didit_internal_id is null`,
        [
          input.hostedPersonIdentityId,
          potpDiditId,
          DiditInternalIdSchema.parse(mapping.diditInternalId),
          providerResult.completedAt,
        ],
      );
      return mapping;
    });
  }

  private async lockIdentity(
    client: Pick<PoolClient, "query">,
    hostedPersonIdentityId: string,
  ): Promise<IdentityRow | undefined> {
    const result = await client.query<IdentityRow>(
      `select status, potp_didit_id as "potpDiditId",
              didit_internal_id::text as "diditInternalId"
         from hosted_auth.person_identities
        where person_id = $1
        for update`,
      [hostedPersonIdentityId],
    );
    return result.rows[0];
  }

  private requireUsable(
    identity: IdentityRow | undefined,
  ): asserts identity is IdentityRow {
    if (!identity || !["pending", "active"].includes(identity.status)) {
      throw new Error("Hosted-auth identity is unavailable for Didit mapping");
    }
    if (!identity.potpDiditId && identity.diditInternalId) {
      throw new Error("Hosted-auth identity has an invalid Didit mapping");
    }
  }

  private mapping(identity: IdentityRow): HostedAuthDiditUserResult {
    return HostedAuthDiditUserResultSchema.parse({
      potpDiditId: identity.potpDiditId,
      diditInternalId: identity.diditInternalId,
    });
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
    throw new Error("A valid Didit mapping timestamp is required");
  }
}
