import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  connectHostedIdentityDatabase,
  type HostedIdentityPool,
} from "./hosted-identity-database.js";

const certificateAuthority =
  "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----";

function fakePool(
  row: { current_user: string; can_use_schema: boolean },
  queryError?: Error,
) {
  let closed = false;
  const pool: HostedIdentityPool = {
    async query<Row extends Record<string, unknown>>() {
      if (queryError) throw queryError;
      return { rows: [row as Row] };
    },
    async end() {
      closed = true;
    },
  };
  return { pool, isClosed: () => closed };
}

describe("connectHostedIdentityDatabase", () => {
  it("fails closed when the production connection is absent", async () => {
    await assert.rejects(
      connectHostedIdentityDatabase({}),
      /Hosted identity database is not configured/,
    );
  });

  it("accepts only the dedicated login with hosted_auth schema access", async () => {
    const expectedUrl =
      "postgresql://POTP_backenduser:secret@db.example.com:5432/postgres";
    const fake = fakePool({
      current_user: "POTP_backenduser",
      can_use_schema: true,
    });
    const database = await connectHostedIdentityDatabase(
      {
        HOSTED_AUTH_DATABASE_URL: expectedUrl,
        HOSTED_AUTH_DATABASE_CA_CERT: certificateAuthority,
      },
      (url, ca) => {
        assert.equal(url, expectedUrl);
        assert.equal(ca, certificateAuthority);
        return fake.pool;
      },
    );

    assert.equal(await database.isReady(), true);
    await database.close();
    assert.equal(fake.isClosed(), true);
  });

  it("closes and rejects a broad or unprivileged connection", async () => {
    const fake = fakePool({ current_user: "postgres", can_use_schema: true });
    await assert.rejects(
      connectHostedIdentityDatabase(
        {
          HOSTED_AUTH_DATABASE_URL:
            "postgresql://postgres:secret@db.example.com:5432/postgres",
          HOSTED_AUTH_DATABASE_CA_CERT: certificateAuthority,
        },
        () => fake.pool,
      ),
      /role or schema grant is invalid/,
    );
    assert.equal(fake.isClosed(), true);
  });
});
