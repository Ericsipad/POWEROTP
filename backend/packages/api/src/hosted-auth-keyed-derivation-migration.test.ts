import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../supabase/migrations/20260822020000_p2_s6_lookup_key_rotation.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("P2-S6 keyed lookup rotation migration", () => {
  it("persists a required positive lookup key version in the unique lookup", () => {
    assert.match(
      migration,
      /lookup_key_version integer not null default 1[\s\S]*check \(lookup_key_version > 0\)/,
    );
    assert.match(
      migration,
      /alter column lookup_key_version drop default/,
    );
    assert.match(
      migration,
      /unique \(identity_data_mode, channel, lookup_key_version, lookup_hash\)/,
    );
  });
});
