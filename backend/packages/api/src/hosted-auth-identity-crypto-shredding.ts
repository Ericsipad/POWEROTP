import type { Pool, PoolClient, QueryResultRow } from "pg";
import { HostedPersonIdentityIdSchema } from "@powerotp/contracts";

import { WrappedIdentityKeyRepository } from "./hosted-auth-durable-repository.js";

type ShredStateRow = QueryResultRow & {
  status: string;
  deletionEligibleAt: Date | null;
  providerCleanupSatisfiedAt: Date | null;
  cryptoShreddedAt: Date | null;
};

export interface HostedAuthIdentityKeyLifecycleAuthority {
  authorizeCryptoShred(input: {
    hostedPersonIdentityId: string;
    satisfiedAt: Date;
  }): Promise<"authorized" | "duplicate">;
  recordCryptoShredded(input: {
    hostedPersonIdentityId: string;
    cryptoShreddedAt: Date;
  }): Promise<"recorded" | "duplicate">;
  assertKeyUsable(hostedPersonIdentityId: string): Promise<void>;
  listCryptoShredded(input: {
    afterIdentityId?: string;
    limit: number;
  }): Promise<
    readonly {
      hostedPersonIdentityId: string;
      cryptoShreddedAt: Date;
    }[]
  >;
}

export class PostgresHostedAuthIdentityKeyLifecycleAuthority
  implements HostedAuthIdentityKeyLifecycleAuthority
{
  constructor(private readonly pool: Pick<Pool, "connect" | "query">) {}

  async authorizeCryptoShred(input: {
    hostedPersonIdentityId: string;
    satisfiedAt: Date;
  }): Promise<"authorized" | "duplicate"> {
    const identityId = HostedPersonIdentityIdSchema.parse(
      input.hostedPersonIdentityId,
    );
    requireDate(input.satisfiedAt);
    return this.inTransaction(async (client) => {
      const state = await this.lockState(client, identityId);
      if (!state) throw new Error("Hosted-auth identity is unavailable");
      if (state.cryptoShreddedAt) return "duplicate";
      if (
        state.status !== "deleting" ||
        !state.deletionEligibleAt ||
        state.deletionEligibleAt > input.satisfiedAt
      ) {
        throw new Error(
          "Hosted-auth identity is not eligible for crypto-shredding",
        );
      }
      await client.query(
        `update hosted_auth.person_identities
            set provider_cleanup_satisfied_at =
                  coalesce(provider_cleanup_satisfied_at, $2),
                updated_at = greatest(updated_at, $2)
          where person_id = $1 and status = 'deleting'`,
        [identityId, input.satisfiedAt],
      );
      return "authorized";
    });
  }

  async recordCryptoShredded(input: {
    hostedPersonIdentityId: string;
    cryptoShreddedAt: Date;
  }): Promise<"recorded" | "duplicate"> {
    const identityId = HostedPersonIdentityIdSchema.parse(
      input.hostedPersonIdentityId,
    );
    requireDate(input.cryptoShreddedAt);
    return this.inTransaction(async (client) => {
      const state = await this.lockState(client, identityId);
      if (!state) throw new Error("Hosted-auth identity is unavailable");
      if (state.cryptoShreddedAt) return "duplicate";
      if (
        state.status !== "deleting" ||
        !state.providerCleanupSatisfiedAt
      ) {
        throw new Error(
          "Provider cleanup and retention eligibility are not durable",
        );
      }
      await client.query(
        `update hosted_auth.person_identities
            set crypto_shredded_at = $2,
                updated_at = greatest(updated_at, $2)
          where person_id = $1 and status = 'deleting'
            and provider_cleanup_satisfied_at is not null
            and crypto_shredded_at is null`,
        [identityId, input.cryptoShreddedAt],
      );
      return "recorded";
    });
  }

  async assertKeyUsable(hostedPersonIdentityId: string): Promise<void> {
    const result = await this.pool.query<
      QueryResultRow & { status: string; cryptoShreddedAt: Date | null }
    >(
      `select status, crypto_shredded_at as "cryptoShreddedAt"
         from hosted_auth.person_identities
        where person_id = $1`,
      [HostedPersonIdentityIdSchema.parse(hostedPersonIdentityId)],
    );
    const state = result.rows[0];
    if (
      !state ||
      !["pending", "active"].includes(state.status) ||
      state.cryptoShreddedAt
    ) {
      throw new Error("Hosted-auth identity key is permanently unavailable");
    }
  }

  async listCryptoShredded(input: {
    afterIdentityId?: string;
    limit: number;
  }): Promise<
    readonly {
      hostedPersonIdentityId: string;
      cryptoShreddedAt: Date;
    }[]
  > {
    requireLimit(input.limit);
    const afterIdentityId = input.afterIdentityId
      ? HostedPersonIdentityIdSchema.parse(input.afterIdentityId)
      : null;
    const result = await this.pool.query<
      QueryResultRow & {
        hostedPersonIdentityId: string;
        cryptoShreddedAt: Date;
      }
    >(
      `select person_id as "hostedPersonIdentityId",
              crypto_shredded_at as "cryptoShreddedAt"
         from hosted_auth.person_identities
        where crypto_shredded_at is not null
          and ($1::text is null or person_id > $1)
        order by person_id
        limit $2`,
      [afterIdentityId, input.limit],
    );
    return result.rows;
  }

  private async lockState(
    client: Pick<PoolClient, "query">,
    hostedPersonIdentityId: string,
  ): Promise<ShredStateRow | null> {
    const result = await client.query<ShredStateRow>(
      `select status, deletion_eligible_at as "deletionEligibleAt",
              provider_cleanup_satisfied_at as "providerCleanupSatisfiedAt",
              crypto_shredded_at as "cryptoShreddedAt"
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

export class HostedAuthIdentityCryptoShredder {
  constructor(
    private readonly authority: HostedAuthIdentityKeyLifecycleAuthority,
    private readonly keys: Pick<WrappedIdentityKeyRepository, "cryptoShred">,
  ) {}

  async shred(input: {
    hostedPersonIdentityId: string;
    completedAt: Date;
  }): Promise<void> {
    await this.authority.authorizeCryptoShred({
      hostedPersonIdentityId: input.hostedPersonIdentityId,
      satisfiedAt: input.completedAt,
    });
    await this.keys.cryptoShred(
      input.hostedPersonIdentityId,
      input.completedAt,
    );
    await this.authority.recordCryptoShredded({
      hostedPersonIdentityId: input.hostedPersonIdentityId,
      cryptoShreddedAt: input.completedAt,
    });
  }

  async reconcileRestoredKeys(limit = 100): Promise<number> {
    requireLimit(limit);
    let afterIdentityId: string | undefined;
    let reconciled = 0;
    for (;;) {
      const batch = await this.authority.listCryptoShredded({
        afterIdentityId,
        limit,
      });
      for (const record of batch) {
        await this.keys.cryptoShred(
          record.hostedPersonIdentityId,
          record.cryptoShreddedAt,
        );
        reconciled += 1;
      }
      if (batch.length < limit) return reconciled;
      afterIdentityId = batch.at(-1)?.hostedPersonIdentityId;
    }
  }
}

function requireDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new Error("A valid hosted-auth crypto-shredding timestamp is required");
  }
}

function requireLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Hosted-auth crypto-shredding limit must be 1-1000");
  }
}
