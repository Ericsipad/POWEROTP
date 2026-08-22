import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Pool } from "pg";

import { PostgresHostedAuthDiditUserMappingRepository } from "./hosted-auth-didit-user-repository.js";

const personId = `hpi_${"A".repeat(43)}`;
const potpDiditId = `pdi_${"A".repeat(43)}`;
const otherPotpDiditId = `pdi_${"E".repeat(43)}`;
const diditInternalId = "2f1c2c6e-65cd-4a4c-8f4b-89d1b10d6e26";
const now = new Date("2026-08-22T07:30:00.000Z");

function fakePool(initial?: {
  status?: string;
  potpDiditId?: string;
  diditInternalId?: string;
}) {
  const state = {
    status: initial?.status ?? "pending",
    potpDiditId: initial?.potpDiditId ?? null,
    diditInternalId: initial?.diditInternalId ?? null,
  };
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let released = false;
  const query = async (text: string, values?: unknown[]) => {
    queries.push({ text, values });
    if (text.includes("select status, potp_didit_id")) {
      return { rows: [{ ...state }] };
    }
    if (text.includes("set potp_didit_id")) {
      state.potpDiditId = String(values?.[1]);
    }
    if (text.includes("set didit_internal_id")) {
      state.diditInternalId = String(values?.[2]);
    }
    return { rows: [] };
  };
  const pool = {
    async connect() {
      return { query, release: () => void (released = true) };
    },
  } as unknown as Pick<Pool, "connect">;
  return { pool, queries, state, released: () => released };
}

describe("Postgres hosted-auth Didit User mapping repository", () => {
  it("locks the person root and durably reserves one POWEROTP Didit ID", async () => {
    const fake = fakePool();
    const repository = new PostgresHostedAuthDiditUserMappingRepository(
      fake.pool,
    );

    const result = await repository.reserve({
      hostedPersonIdentityId: personId,
      proposedPotpDiditId: potpDiditId,
      reservedAt: now,
    });

    assert.deepEqual(result, { status: "reserved", potpDiditId });
    assert.equal(fake.state.potpDiditId, potpDiditId);
    assert.equal(
      fake.queries.some(({ text }) => text.includes("for update")),
      true,
    );
    assert.equal(fake.queries.at(-1)?.text, "commit");
    assert.equal(fake.released(), true);
  });

  it("reuses an incomplete reservation and never replaces its vendor data", async () => {
    const fake = fakePool({ potpDiditId });
    const repository = new PostgresHostedAuthDiditUserMappingRepository(
      fake.pool,
    );

    const result = await repository.reserve({
      hostedPersonIdentityId: personId,
      proposedPotpDiditId: otherPotpDiditId,
      reservedAt: now,
    });

    assert.deepEqual(result, { status: "reserved", potpDiditId });
    assert.equal(
      fake.queries.some(({ text }) => text.includes("set potp_didit_id")),
      false,
    );
  });

  it("completes the exact mapping and idempotently returns it", async () => {
    const fake = fakePool({ potpDiditId });
    const repository = new PostgresHostedAuthDiditUserMappingRepository(
      fake.pool,
    );

    const first = await repository.completeWithProvider(
      { hostedPersonIdentityId: personId, potpDiditId },
      async () => {
        assert.match(fake.queries.at(-1)?.text ?? "", /for update/);
        assert.equal(
          fake.queries.some(({ text }) => text === "commit"),
          false,
        );
        return {
          mapping: { potpDiditId, diditInternalId },
          completedAt: now,
        };
      },
    );
    const second = await repository.completeWithProvider(
      { hostedPersonIdentityId: personId, potpDiditId },
      async () => {
        throw new Error("provider must not be called for a complete mapping");
      },
    );

    assert.deepEqual(first, { potpDiditId, diditInternalId });
    assert.deepEqual(second, first);
    assert.equal(
      fake.queries.filter(({ text }) => text.includes("set didit_internal_id"))
        .length,
      1,
    );
  });

  it("rejects a different reservation, provider User, or blocked identity", async () => {
    const reserved = new PostgresHostedAuthDiditUserMappingRepository(
      fakePool({ potpDiditId }).pool,
    );
    await assert.rejects(
      reserved.completeWithProvider(
        {
          hostedPersonIdentityId: personId,
          potpDiditId: otherPotpDiditId,
        },
        async () => ({
          mapping: { potpDiditId: otherPotpDiditId, diditInternalId },
          completedAt: now,
        }),
      ),
      /reservation does not match/,
    );

    const mismatched = new PostgresHostedAuthDiditUserMappingRepository(
      fakePool({ potpDiditId }).pool,
    );
    await assert.rejects(
      mismatched.completeWithProvider(
        { hostedPersonIdentityId: personId, potpDiditId },
        async () => ({
          mapping: { potpDiditId: otherPotpDiditId, diditInternalId },
          completedAt: now,
        }),
      ),
      /does not match the reserved mapping/,
    );

    const deleting = new PostgresHostedAuthDiditUserMappingRepository(
      fakePool({ status: "deleting" }).pool,
    );
    await assert.rejects(
      deleting.reserve({
        hostedPersonIdentityId: personId,
        proposedPotpDiditId: potpDiditId,
        reservedAt: now,
      }),
      /unavailable/,
    );
  });
});
