import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../supabase/migrations/20260822030000_p2_s10_crypto_shredding.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("P2-S10 identity crypto-shredding migration", () => {
  it("persists provider/retention satisfaction before irreversible shredding", () => {
    assert.match(migration, /provider_cleanup_satisfied_at timestamptz/);
    assert.match(migration, /crypto_shredded_at timestamptz/);
    assert.match(
      migration,
      /provider_cleanup_satisfied_at >= deletion_eligible_at/,
    );
    assert.match(
      migration,
      /crypto_shredded_at >= provider_cleanup_satisfied_at/,
    );
    assert.match(migration, /status <> 'deleted' or crypto_shredded_at is not null/);
  });
});
