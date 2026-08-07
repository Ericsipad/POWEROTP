import type { Db } from "mongodb";

/**
 * A published recording is immutable: its audio bytes, checksum, and
 * duration never change once created. Retiring one only stops it from
 * being selected for new interactions or synced to nodes going forward —
 * it never invalidates a `challengeDefinitions` row or an in-flight
 * interaction that already reference it, and never deletes the underlying
 * Spaces object (see `apps/api/src/challenge-service.ts`).
 */
export interface RecordingAssetDocument {
  _id: string;
  spacesKey: string;
  durationMs: number;
  checksumSha256: string;
  status: "published" | "retired";
  createdAt: Date;
  retiredAt?: Date;
}

/**
 * A challenge pins one immutable recording version and question/option
 * set. `correctOptionKeysEncrypted` is authenticated-encrypted with
 * `CONFIG_ENCRYPTION_KEY` (same primitive as `expectedCodeEncrypted`) —
 * even though the admin who authored a challenge already knows the
 * answer, nothing reads it back out except grading a live submission.
 */
export interface ChallengeDefinitionDocument {
  _id: string;
  recordingAssetId: string;
  question: string;
  options: { key: string; label: string }[];
  correctOptionKeysEncrypted: string;
  allowsMultiple: boolean;
  minSelections: number;
  maxSelections: number;
  status: "published" | "retired";
  createdAt: Date;
  retiredAt?: Date;
}

export async function ensureChallengeIndexes(db: Db) {
  await Promise.all([
    db
      .collection<RecordingAssetDocument>("recordingAssets")
      .createIndex({ status: 1, createdAt: -1 }),
    db
      .collection<ChallengeDefinitionDocument>("challengeDefinitions")
      .createIndex({ status: 1, createdAt: -1 }),
    db
      .collection<ChallengeDefinitionDocument>("challengeDefinitions")
      .createIndex({ recordingAssetId: 1 }),
  ]);
}
