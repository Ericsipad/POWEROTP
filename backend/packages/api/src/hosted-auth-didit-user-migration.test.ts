import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../supabase/migrations/20260822073000_p4_s4_didit_user_mapping.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("P4-S4 Didit User mapping migration", () => {
  it("permits a durable vendor-data reservation but never an internal ID without it", () => {
    assert.match(
      migration,
      /drop constraint %I[\s\S]*person_identities_didit_mapping_order_check/,
    );
    assert.match(
      migration,
      /check \(didit_internal_id is null or potp_didit_id is not null\)/,
    );
    assert.doesNotMatch(
      migration,
      /drop (column|table)|disable row level security/i,
    );
  });
});
