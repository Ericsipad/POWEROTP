import { createHmac } from "node:crypto";

import {
  HostedAuthContactScopeSchema,
  HostedAuthProviderEvidenceReferenceSchema,
  HostedAuthProviderOperationIdSchema,
  HostedAuthRequestIdSchema,
  type HostedAuthContactScope,
  type HostedAuthProviderOperationId,
} from "@powerotp/contracts";
import type { Collection, Db } from "mongodb";
import type { z } from "zod";

import { createSortableId, safeEqual } from "./security.js";

type HostedAuthProviderEvidenceReference = z.infer<
  typeof HostedAuthProviderEvidenceReferenceSchema
>;

export const HOSTED_AUTH_EMAIL_CHALLENGE_COLLECTION_NAME =
  "hostedAuthEmailChallenges";
export const HOSTED_AUTH_EMAIL_CHALLENGE_TTL_MS = 10 * 60 * 1_000;

interface HostedAuthEmailChallengeDocument {
  _id: string;
  authRequestId: string;
  scope: HostedAuthContactScope;
  destinationHash: string;
  codeHash: string;
  evidenceReference: string;
  createdAt: Date;
  expiresAt: Date;
  purgeAt: Date;
  consumedAt?: Date;
}

type ChallengeCollection = Pick<
  Collection<HostedAuthEmailChallengeDocument>,
  "createIndex" | "findOne" | "findOneAndUpdate" | "insertOne"
>;

export type HostedAuthEmailProofVerification =
  | Readonly<{
      status: "verified";
      minimalEvidenceReference: HostedAuthProviderEvidenceReference;
    }>
  | Readonly<{ status: "rejected" }>;

export async function ensureHostedAuthEmailChallengeIndexes(
  db: Db,
): Promise<void> {
  const challenges = db.collection<HostedAuthEmailChallengeDocument>(
    HOSTED_AUTH_EMAIL_CHALLENGE_COLLECTION_NAME,
  );
  await Promise.all([
    challenges.createIndex(
      { purgeAt: 1 },
      { expireAfterSeconds: 0, name: "purgeAt_ttl" },
    ),
    challenges.createIndex(
      { authRequestId: 1, "scope.providerPurpose": 1, createdAt: -1 },
      { name: "request_purpose_created" },
    ),
  ]);
}

export class HostedAuthEmailChallengeRepository {
  private readonly challenges: ChallengeCollection;

  constructor(
    db: Db,
    private readonly hashSecret: string,
    collection?: ChallengeCollection,
  ) {
    if (hashSecret.length < 32) {
      throw new Error("Hosted-auth email challenge hash secret must be at least 32 characters");
    }
    this.challenges =
      collection ??
      db.collection<HostedAuthEmailChallengeDocument>(
        HOSTED_AUTH_EMAIL_CHALLENGE_COLLECTION_NAME,
      );
  }

  async issue(input: {
    authRequestId: string;
    scope: HostedAuthContactScope;
    destination: string;
    code: string;
    now?: Date;
  }): Promise<HostedAuthProviderOperationId> {
    const authRequestId = HostedAuthRequestIdSchema.parse(input.authRequestId);
    const scope = HostedAuthContactScopeSchema.parse(input.scope);
    const createdAt = input.now ?? new Date();
    const providerOperationId = HostedAuthProviderOperationIdSchema.parse(
      createSortableId("hae"),
    );
    const evidenceReference = HostedAuthProviderEvidenceReferenceSchema.parse(
      createSortableId("hev"),
    );
    const expiresAt = new Date(
      createdAt.getTime() + HOSTED_AUTH_EMAIL_CHALLENGE_TTL_MS,
    );

    await this.challenges.insertOne({
      _id: providerOperationId,
      authRequestId,
      scope,
      destinationHash: this.#hashDestination(input.destination),
      codeHash: this.#hashCode(providerOperationId, scope, input.code),
      evidenceReference,
      createdAt,
      expiresAt,
      purgeAt: expiresAt,
    });
    return providerOperationId;
  }

  async verifyAndConsume(input: {
    authRequestId: string;
    scope: HostedAuthContactScope;
    destination: string;
    providerOperationId: string;
    proof: string;
    now?: Date;
  }): Promise<HostedAuthEmailProofVerification> {
    const authRequestId = HostedAuthRequestIdSchema.parse(input.authRequestId);
    const scope = HostedAuthContactScopeSchema.parse(input.scope);
    const providerOperationId = HostedAuthProviderOperationIdSchema.parse(
      input.providerOperationId,
    );
    const now = input.now ?? new Date();
    const challenge = await this.challenges.findOne({
      _id: providerOperationId,
      authRequestId,
      scope,
      destinationHash: this.#hashDestination(input.destination),
      expiresAt: { $gt: now },
      consumedAt: { $exists: false },
    });
    if (!challenge) return { status: "rejected" };

    const submittedHash = this.#hashCode(
      providerOperationId,
      scope,
      input.proof,
    );
    if (!safeEqual(challenge.codeHash, submittedHash)) {
      return { status: "rejected" };
    }

    const consumed = await this.challenges.findOneAndUpdate(
      {
        _id: providerOperationId,
        authRequestId,
        scope,
        destinationHash: this.#hashDestination(input.destination),
        codeHash: submittedHash,
        expiresAt: { $gt: now },
        consumedAt: { $exists: false },
      },
      { $set: { consumedAt: now, purgeAt: now } },
      { returnDocument: "after" },
    );
    if (!consumed) return { status: "rejected" };
    return {
      status: "verified",
      minimalEvidenceReference:
        HostedAuthProviderEvidenceReferenceSchema.parse(
          consumed.evidenceReference,
        ),
    };
  }

  #hashCode(
    providerOperationId: HostedAuthProviderOperationId,
    scope: HostedAuthContactScope,
    code: string,
  ): string {
    return createHmac("sha256", this.hashSecret)
      .update("powerotp-hosted-auth-email-proof-v1\0")
      .update(providerOperationId)
      .update("\0")
      .update(scope.projectId)
      .update("\0")
      .update(scope.realm.identityDataMode)
      .update("\0")
      .update(scope.flow)
      .update("\0")
      .update(scope.providerPurpose)
      .update("\0")
      .update(code)
      .digest("base64url");
  }

  #hashDestination(destination: string): string {
    return createHmac("sha256", this.hashSecret)
      .update("powerotp-hosted-auth-email-destination-v1\0")
      .update(destination.trim().toLowerCase())
      .digest("base64url");
  }
}
