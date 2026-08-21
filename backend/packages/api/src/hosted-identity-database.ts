import { Pool } from "pg";

import type { ProductionConfig } from "./config.js";

const HOSTED_IDENTITY_DATABASE_ROLE = "POTP_backenduser";

interface QueryResult<Row> {
  rows: Row[];
}

export interface HostedIdentityDatabase {
  isReady(): Promise<boolean>;
  close(): Promise<void>;
}

export interface HostedIdentityPool {
  query<Row extends Record<string, unknown>>(text: string): Promise<QueryResult<Row>>;
  end(): Promise<void>;
}

type PoolFactory = (
  connectionString: string,
  certificateAuthority: string,
) => HostedIdentityPool;

function createPool(
  connectionString: string,
  certificateAuthority: string,
): HostedIdentityPool {
  return new Pool({
    connectionString,
    application_name: "powerotp-hosted-identity",
    connectionTimeoutMillis: 10_000,
    max: 5,
    ssl: {
      ca: certificateAuthority,
      rejectUnauthorized: true,
    },
  });
}

async function checkReady(pool: HostedIdentityPool): Promise<boolean> {
  const result = await pool.query<{
    current_user: string;
    can_use_schema: boolean;
  }>(
    "select current_user, has_schema_privilege(current_user, 'hosted_auth', 'USAGE') as can_use_schema",
  );
  return (
    result.rows[0]?.current_user === HOSTED_IDENTITY_DATABASE_ROLE &&
    result.rows[0]?.can_use_schema === true
  );
}

export async function connectHostedIdentityDatabase(
  config: Pick<
    ProductionConfig,
    "HOSTED_AUTH_DATABASE_URL" | "HOSTED_AUTH_DATABASE_CA_CERT"
  >,
  poolFactory: PoolFactory = createPool,
): Promise<HostedIdentityDatabase> {
  if (
    !config.HOSTED_AUTH_DATABASE_URL ||
    !config.HOSTED_AUTH_DATABASE_CA_CERT
  ) {
    throw new Error("Hosted identity database is not configured");
  }

  const pool = poolFactory(
    config.HOSTED_AUTH_DATABASE_URL,
    config.HOSTED_AUTH_DATABASE_CA_CERT,
  );
  try {
    if (!(await checkReady(pool))) {
      throw new Error("Hosted identity database role or schema grant is invalid");
    }
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    async isReady() {
      try {
        return await checkReady(pool);
      } catch {
        return false;
      }
    },
    async close() {
      await pool.end();
    },
  };
}
