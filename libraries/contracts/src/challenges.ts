import { z } from "zod";

/**
 * Platform-admin-authored recording/challenge catalog for `voice_challenge`
 * (Type 3). Recordings and challenges are immutable once published — an
 * edit is always a new upload/challenge, never a mutation of a version a
 * live interaction might already be bound to (see
 * `apps/api/src/challenge-service.ts`).
 */
export const RecordingAssetStatusSchema = z.enum(["published", "retired"]);

export const RecordingAssetSchema = z.object({
  id: z.string().min(16),
  durationMs: z.number().int().positive(),
  checksumSha256: z.string().length(64),
  status: RecordingAssetStatusSchema,
  createdAt: z.string().datetime(),
});

export const ChallengeOptionInputSchema = z.object({
  label: z.string().min(1).max(2_000),
});

/**
 * Admin authoring input. Mirrors the invariants of the customer-facing
 * `ChallengeSchema` in `verification.ts` (min/max selections, single-answer
 * rule) so a published challenge can never violate what customers are
 * promised once it is materialized for a real interaction.
 */
export const CreateChallengeSchema = z
  .object({
    recordingAssetId: z.string().min(16),
    question: z.string().min(1).max(4_000),
    options: z.array(ChallengeOptionInputSchema).min(2).max(100),
    correctOptionIndexes: z.array(z.number().int().nonnegative()).min(1),
    allowsMultiple: z.boolean().default(false),
    minSelections: z.number().int().positive().default(1),
    maxSelections: z.number().int().positive().default(1),
  })
  .superRefine((challenge, context) => {
    if (challenge.minSelections > challenge.maxSelections) {
      context.addIssue({
        code: "custom",
        message: "minSelections cannot exceed maxSelections",
        path: ["minSelections"],
      });
    }
    if (challenge.maxSelections > challenge.options.length) {
      context.addIssue({
        code: "custom",
        message: "maxSelections cannot exceed the number of options",
        path: ["maxSelections"],
      });
    }
    if (!challenge.allowsMultiple && challenge.maxSelections !== 1) {
      context.addIssue({
        code: "custom",
        message: "Single-answer challenges must allow exactly one selection",
        path: ["maxSelections"],
      });
    }
    if (challenge.correctOptionIndexes.some((index) => index >= challenge.options.length)) {
      context.addIssue({
        code: "custom",
        message: "correctOptionIndexes must reference an existing option",
        path: ["correctOptionIndexes"],
      });
    }
    if (
      challenge.correctOptionIndexes.length < challenge.minSelections ||
      challenge.correctOptionIndexes.length > challenge.maxSelections
    ) {
      context.addIssue({
        code: "custom",
        message: "correctOptionIndexes must satisfy min/maxSelections",
        path: ["correctOptionIndexes"],
      });
    }
  });

export const ChallengeDefinitionStatusSchema = z.enum(["published", "retired"]);

/**
 * Admin listing shape. Deliberately omits which options are correct —
 * challenges are immutable once created, so the admin who authored one
 * never needs to re-view its answer key through the API, and correct
 * answers stay off every response surface (see `docs/THREAT_MODEL.md`).
 */
export const ChallengeDefinitionSchema = z.object({
  id: z.string().min(16),
  recordingAssetId: z.string().min(16),
  question: z.string(),
  options: z.array(z.object({ key: z.string(), label: z.string() })),
  allowsMultiple: z.boolean(),
  minSelections: z.number().int().positive(),
  maxSelections: z.number().int().positive(),
  status: ChallengeDefinitionStatusSchema,
  createdAt: z.string().datetime(),
});

/**
 * What a node pulls to know which recordings it needs locally and where to
 * download them from. `manifestToken` is a signed opaque payload (see
 * `apps/api/src/challenge-service.ts#currentManifest`) covering everything
 * except `downloadUrls` — those are short-lived presigned Spaces URLs,
 * regenerated per request, so they are not part of the signed payload; the
 * node verifies the signed manifest first, then uses the accompanying URL
 * for whichever asset it needs, and checksums the download against the
 * signed `sha256` before trusting it locally.
 */
export const MediaManifestAssetSchema = z.object({
  assetId: z.string().min(16),
  sha256: z.string().length(64),
  durationMs: z.number().int().positive(),
  soundBasename: z.string().min(1),
});

export const MediaManifestSchema = z.object({
  manifestVersion: z.number().int().positive(),
  issuedAt: z.string().datetime(),
  assets: z.array(MediaManifestAssetSchema),
});

export const MediaManifestResponseSchema = z.object({
  manifestToken: z.string().min(1),
  downloadUrls: z.record(z.string(), z.string().url()),
});

export type RecordingAsset = z.infer<typeof RecordingAssetSchema>;
export type CreateChallenge = z.infer<typeof CreateChallengeSchema>;
export type ChallengeDefinition = z.infer<typeof ChallengeDefinitionSchema>;
export type MediaManifestAsset = z.infer<typeof MediaManifestAssetSchema>;
export type MediaManifest = z.infer<typeof MediaManifestSchema>;
export type MediaManifestResponse = z.infer<typeof MediaManifestResponseSchema>;
