import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../supabase/migrations/20260822023000_p2_s9_identity_deletion.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("P2-S9 identity deletion migration", () => {
  it("persists explicit policy eligibility and retry leasing", () => {
    assert.match(migration, /deletion_requested_at timestamptz/);
    assert.match(migration, /deletion_eligible_at timestamptz/);
    assert.match(migration, /deletion_claimed_at timestamptz/);
    assert.match(
      migration,
      /deletion_eligible_at >= deletion_requested_at/,
    );
    assert.match(
      migration,
      /where status = 'deleting'/,
    );
  });
});
