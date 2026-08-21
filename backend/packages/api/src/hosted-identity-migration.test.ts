import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../supabase/migrations/20260821223500_p2_s1_hosted_identity.sql",
    import.meta.url,
  ),
  "utf8",
);

const tables = [
  "person_identities",
  "auth_profiles",
  "webauthn_credentials",
  "encrypted_identity_attributes",
  "contacts",
  "consent_records",
  "identity_verifications",
] as const;

describe("P2-S1 hosted identity migration", () => {
  it("contains only the seven Supabase identity-custody tables", () => {
    const created = [
      ...migration.matchAll(/create table hosted_auth\.([a-z_]+)/g),
    ].map((match) => match[1]);
    assert.deepEqual(created, tables);
    assert.doesNotMatch(
      migration,
      /\b(auth_requests|poll_tokens|poll_results|project_identity_bindings)\b/,
    );
  });

  it("locks profiles and credentials to their exact custody realm", () => {
    assert.match(
      migration,
      /identity_data_mode = 'powerotp_pii' and rp_id = 'authx\.powerotp\.com'/,
    );
    assert.match(
      migration,
      /identity_data_mode = 'didit_pii' and rp_id = 'authz\.powerotp\.com'/,
    );
    assert.match(migration, /unique \(person_id, identity_data_mode\)/);
    assert.match(
      migration,
      /foreign key \(profile_id, identity_data_mode\)[\s\S]*?references hosted_auth\.auth_profiles/,
    );
  });

  it("prevents recoverable contact storage in didit_pii", () => {
    assert.match(
      migration,
      /identity_data_mode = 'powerotp_pii' and encrypted_attribute_id is not null and didit_contact_reference is null/,
    );
    assert.match(
      migration,
      /identity_data_mode = 'didit_pii' and encrypted_attribute_id is null and didit_contact_reference is not null/,
    );
    assert.match(
      migration,
      /identity_data_mode hosted_auth\.identity_data_mode not null default 'powerotp_pii'\s+check \(identity_data_mode = 'powerotp_pii'\)/,
    );
  });

  it("denies Supabase client roles and forces RLS on every table", () => {
    for (const table of tables) {
      assert.match(
        migration,
        new RegExp(
          `alter table hosted_auth\\.${table} force row level security`,
        ),
      );
    }
    assert.match(
      migration,
      /revoke all on all tables in schema hosted_auth from public, anon, authenticated, service_role/,
    );
    assert.match(
      migration,
      /for all to potp_hosted_auth_service, potp_identity_admin using \(true\) with check \(true\)/,
    );
  });
});
