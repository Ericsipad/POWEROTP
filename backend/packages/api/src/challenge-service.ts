import type { ChallengeDefinition, CreateChallenge, RecordingAsset } from "@powerotp/contracts";
import type { Db } from "mongodb";

import type {
  ChallengeDefinitionDocument,
  RecordingAssetDocument,
} from "./challenge-persistence.js";
import type { ProductionConfig } from "./config.js";
import { normalizeRecording } from "./media-service.js";
import type { AuditDocument } from "./persistence.js";
import {
  createId,
  createSortableId,
  decryptString,
  encryptString,
  safeEqual,
  signPayload,
  verifySignedPayload,
} from "./security.js";
import { createSpacesClient, type SpacesClient } from "./spaces-client.js";

export class ChallengeError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

/** Embedded, per-interaction snapshot bound once at creation (see
 * `VerificationService#create`) — never re-derived from the mutable
 * catalog, so a retired challenge cannot break an in-flight interaction. */
export interface InteractionChallenge {
  challengeDefinitionId: string;
  recordingAssetId: string;
  question: string;
  allowsMultiple: boolean;
  minSelections: number;
  maxSelections: number;
  options: { id: string; label: string }[];
  expectedAnswerOptionIdsEncrypted: string;
}

export interface MediaManifestBundle {
  manifestToken: string;
  downloadUrls: Record<string, string>;
}

type ChallengeConfig = Pick<
  ProductionConfig,
  | "CONFIG_ENCRYPTION_KEY"
  | "MEDIA_MANIFEST_SECRET"
  | "SPACES_ENDPOINT"
  | "SPACES_BUCKET"
  | "SPACES_ACCESS_KEY"
  | "SPACES_SECRET_KEY"
>;

/**
 * Owns the immutable admin-authored recording/challenge catalog for
 * `voice_challenge` (Type 3): validated/normalized recording publication,
 * random challenge selection with per-interaction opaque option IDs,
 * encrypted answer grading, and the signed media manifest telephony nodes
 * verify before trusting a checksum (see `docs/AS_BUILT.md`).
 */
export class ChallengeService {
  readonly #recordings;
  readonly #challenges;
  readonly #audits;

  constructor(
    db: Db,
    private readonly config: ChallengeConfig,
    private readonly spaces: SpacesClient | undefined = createSpacesClient(config),
  ) {
    this.#recordings = db.collection<RecordingAssetDocument>("recordingAssets");
    this.#challenges = db.collection<ChallengeDefinitionDocument>("challengeDefinitions");
    this.#audits = db.collection<AuditDocument>("auditEvents");
  }

  async publishRecording(upload: Buffer, actorId: string): Promise<RecordingAsset> {
    if (!this.spaces) throw new ChallengeError("media_storage_not_configured", 409);

    const normalized = await normalizeRecording(upload);
    const id = createSortableId("rec");
    const spacesKey = `recordings/${id}.wav`;
    await this.spaces.putObject(spacesKey, normalized.buffer, "audio/wav");

    const document: RecordingAssetDocument = {
      _id: id,
      spacesKey,
      durationMs: normalized.durationMs,
      checksumSha256: normalized.checksumSha256,
      status: "published",
      createdAt: new Date(),
    };
    await this.#recordings.insertOne(document);
    await this.#audit(actorId, "recording.published", "recording", id);
    return this.#recordingToResponse(document);
  }

  async listRecordings(): Promise<RecordingAsset[]> {
    const documents = await this.#recordings.find().sort({ createdAt: -1 }).toArray();
    return documents.map((document) => this.#recordingToResponse(document));
  }

  async retireRecording(id: string, actorId: string): Promise<void> {
    await this.#recordings.updateOne(
      { _id: id, status: "published" },
      { $set: { status: "retired", retiredAt: new Date() } },
    );
    await this.#audit(actorId, "recording.retired", "recording", id);
  }

  async createChallenge(input: CreateChallenge, actorId: string): Promise<ChallengeDefinition> {
    const recording = await this.#recordings.findOne({
      _id: input.recordingAssetId,
      status: "published",
    });
    if (!recording) throw new ChallengeError("recording_not_found", 404);

    const options = input.options.map((option) => ({
      key: createId("opt"),
      label: option.label,
    }));
    const correctOptionKeys = input.correctOptionIndexes.map((index) => options[index]!.key);

    const document: ChallengeDefinitionDocument = {
      _id: createSortableId("chl"),
      recordingAssetId: input.recordingAssetId,
      question: input.question,
      options,
      correctOptionKeysEncrypted: encryptString(
        JSON.stringify(correctOptionKeys),
        this.config.CONFIG_ENCRYPTION_KEY,
      ),
      allowsMultiple: input.allowsMultiple,
      minSelections: input.minSelections,
      maxSelections: input.maxSelections,
      status: "published",
      createdAt: new Date(),
    };
    await this.#challenges.insertOne(document);
    await this.#audit(actorId, "challenge.published", "challenge", document._id);
    return this.#challengeToResponse(document);
  }

  async listChallenges(): Promise<ChallengeDefinition[]> {
    const documents = await this.#challenges.find().sort({ createdAt: -1 }).toArray();
    return documents.map((document) => this.#challengeToResponse(document));
  }

  async retireChallenge(id: string, actorId: string): Promise<void> {
    await this.#challenges.updateOne(
      { _id: id, status: "published" },
      { $set: { status: "retired", retiredAt: new Date() } },
    );
    await this.#audit(actorId, "challenge.retired", "challenge", id);
  }

  /**
   * Picks one published challenge whose recording is also still published,
   * generates fresh per-interaction opaque option IDs in random order, and
   * encrypts the correct set under those new IDs — never the admin's
   * stable option keys — so nothing outside this call ever learns which
   * key was correct. Returns `undefined` when no eligible challenge
   * exists, which the caller (`VerificationService#create`) treats as
   * `method_not_available`, same as an unconfigured trunk.
   */
  async selectAndMaterialize(): Promise<InteractionChallenge | undefined> {
    const publishedRecordingIds = await this.#recordings.distinct("_id", { status: "published" });
    if (publishedRecordingIds.length === 0) return undefined;

    const [challenge] = await this.#challenges
      .aggregate<ChallengeDefinitionDocument>([
        { $match: { status: "published", recordingAssetId: { $in: publishedRecordingIds } } },
        { $sample: { size: 1 } },
      ])
      .toArray();
    if (!challenge) return undefined;

    const shuffled = shuffle(challenge.options);
    const optionIdByKey = new Map(shuffled.map((option) => [option.key, createSortableId("opt")]));
    const correctKeys = JSON.parse(
      decryptString(challenge.correctOptionKeysEncrypted, this.config.CONFIG_ENCRYPTION_KEY),
    ) as string[];
    const expectedIds = correctKeys.map((key) => optionIdByKey.get(key)!);

    return {
      challengeDefinitionId: challenge._id,
      recordingAssetId: challenge.recordingAssetId,
      question: challenge.question,
      allowsMultiple: challenge.allowsMultiple,
      minSelections: challenge.minSelections,
      maxSelections: challenge.maxSelections,
      options: shuffled.map((option) => ({
        id: optionIdByKey.get(option.key)!,
        label: option.label,
      })),
      expectedAnswerOptionIdsEncrypted: encryptString(
        JSON.stringify(expectedIds),
        this.config.CONFIG_ENCRYPTION_KEY,
      ),
    };
  }

  /** Exact-set comparison: any deviation (wrong, partial, extra, replayed
   * option IDs) fails. Grading never distinguishes *why* it failed in any
   * response, matching `docs/MVP_ACCEPTANCE.md`'s Type 3 requirements. */
  gradeSubmission(expectedAnswerOptionIdsEncrypted: string, submittedOptionIds: string[]): boolean {
    const expectedIds = JSON.parse(
      decryptString(expectedAnswerOptionIdsEncrypted, this.config.CONFIG_ENCRYPTION_KEY),
    ) as string[];
    if (expectedIds.length !== submittedOptionIds.length) return false;

    const expectedSorted = [...expectedIds].sort();
    const submittedSorted = [...submittedOptionIds].sort();
    return expectedSorted.every((id, index) => safeEqual(id, submittedSorted[index]!));
  }

  soundBasenameFor(recordingAssetId: string): string {
    return `potp-challenge-${recordingAssetId}`;
  }

  /**
   * Builds the manifest a node verifies before syncing recordings. Only
   * recordings actually referenced by a currently published challenge are
   * included, so retiring a challenge naturally stops distributing audio
   * nothing can select anymore. Returns `undefined` when Spaces or the
   * manifest secret is not yet configured — `voice_challenge` then simply
   * has nothing to sync, matching the deferred-credential convention.
   */
  async currentManifest(): Promise<MediaManifestBundle | undefined> {
    if (!this.spaces || !this.config.MEDIA_MANIFEST_SECRET) return undefined;

    const referencedIds = await this.#challenges.distinct("recordingAssetId", {
      status: "published",
    });
    if (referencedIds.length === 0) return undefined;

    const recordings = await this.#recordings
      .find({ _id: { $in: referencedIds }, status: "published" })
      .toArray();
    if (recordings.length === 0) return undefined;

    const assets = recordings.map((recording) => ({
      assetId: recording._id,
      sha256: recording.checksumSha256,
      durationMs: recording.durationMs,
      soundBasename: this.soundBasenameFor(recording._id),
    }));
    const manifestToken = signPayload(
      { manifestVersion: Date.now(), issuedAt: new Date().toISOString(), assets },
      this.config.MEDIA_MANIFEST_SECRET,
    );
    const downloadUrls: Record<string, string> = {};
    for (const recording of recordings) {
      downloadUrls[recording._id] = await this.spaces.presignedGetUrl(recording.spacesKey);
    }
    return { manifestToken, downloadUrls };
  }

  async #audit(actorId: string, action: string, targetType: string, targetId: string) {
    await this.#audits.insertOne({
      _id: createId("aud"),
      actorId,
      action,
      targetType,
      targetId,
      occurredAt: new Date(),
    });
  }

  #recordingToResponse(document: RecordingAssetDocument): RecordingAsset {
    return {
      id: document._id,
      durationMs: document.durationMs,
      checksumSha256: document.checksumSha256,
      status: document.status,
      createdAt: document.createdAt.toISOString(),
    };
  }

  #challengeToResponse(document: ChallengeDefinitionDocument): ChallengeDefinition {
    return {
      id: document._id,
      recordingAssetId: document.recordingAssetId,
      question: document.question,
      options: document.options,
      allowsMultiple: document.allowsMultiple,
      minSelections: document.minSelections,
      maxSelections: document.maxSelections,
      status: document.status,
      createdAt: document.createdAt.toISOString(),
    };
  }
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
