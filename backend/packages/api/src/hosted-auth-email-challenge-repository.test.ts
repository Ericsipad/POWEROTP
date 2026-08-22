import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedAuthContactScopeSchema,
  HostedAuthRequestIdSchema,
  hostedAuthRealms,
} from "@powerotp/contracts";
import type { Collection, Db } from "mongodb";

import {
  HOSTED_AUTH_EMAIL_CHALLENGE_TTL_MS,
  HostedAuthEmailChallengeRepository,
} from "./hosted-auth-email-challenge-repository.js";

const authRequestId = HostedAuthRequestIdSchema.parse(
  `har_${"A".repeat(43)}`,
);
const signupScope = HostedAuthContactScopeSchema.parse({
  projectId: "project_scope_0001",
  realm: hostedAuthRealms.powerotp_pii,
  flow: "signup",
  providerPurpose: "signup_contact_enrollment",
});

type ChallengeDocument = {
  _id: string;
  authRequestId: string;
  scope: typeof signupScope;
  codeHash: string;
  evidenceReference: string;
  createdAt: Date;
  expiresAt: Date;
  purgeAt: Date;
  consumedAt?: Date;
};

class MemoryChallengeCollection {
  readonly documents = new Map<string, ChallengeDocument>();

  async insertOne(document: ChallengeDocument) {
    this.documents.set(document._id, structuredClone(document));
    return { acknowledged: true, insertedId: document._id };
  }

  async findOne(filter: Record<string, unknown>) {
    const document = this.#matching(filter);
    return document ? structuredClone(document) : null;
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: { $set: Partial<ChallengeDocument> },
  ) {
    const document = this.#matching(filter);
    if (!document) return null;
    const updated = { ...document, ...update.$set };
    this.documents.set(document._id, updated);
    return structuredClone(updated);
  }

  #matching(filter: Record<string, unknown>) {
    const document = this.documents.get(String(filter._id));
    const expiry = filter.expiresAt as { $gt?: Date } | undefined;
    const unconsumed =
      (filter.consumedAt as { $exists?: boolean } | undefined)?.$exists ===
      false;
    return document &&
      document.authRequestId === filter.authRequestId &&
      JSON.stringify(document.scope) === JSON.stringify(filter.scope) &&
      (filter.codeHash === undefined || document.codeHash === filter.codeHash) &&
      (!expiry?.$gt || document.expiresAt > expiry.$gt) &&
      (!unconsumed || !document.consumedAt)
      ? document
      : undefined;
  }
}

function repository() {
  const collection = new MemoryChallengeCollection();
  return {
    collection,
    repository: new HostedAuthEmailChallengeRepository(
      {} as Db,
      "hosted-auth-email-test-secret".repeat(2),
      collection as unknown as Collection<ChallengeDocument>,
    ),
  };
}

describe("hosted-auth email challenge repository", () => {
  it("binds a one-time proof to its request, custody realm, flow, and purpose", async () => {
    const { repository: challenges } = repository();
    const now = new Date("2026-08-22T05:30:00.000Z");
    const operationId = await challenges.issue({
      authRequestId,
      scope: signupScope,
      code: "12345",
      now,
    });

    assert.deepEqual(
      await challenges.verifyAndConsume({
        authRequestId,
        scope: {
          ...signupScope,
          projectId: "project_scope_0002",
        },
        providerOperationId: operationId,
        proof: "12345",
        now,
      }),
      { status: "rejected" },
    );
    assert.deepEqual(
      await challenges.verifyAndConsume({
        authRequestId,
        scope: signupScope,
        providerOperationId: operationId,
        proof: "99999",
        now,
      }),
      { status: "rejected" },
    );

    const verified = await challenges.verifyAndConsume({
      authRequestId,
      scope: signupScope,
      providerOperationId: operationId,
      proof: "12345",
      now,
    });
    assert.equal(verified.status, "verified");
    assert.deepEqual(
      await challenges.verifyAndConsume({
        authRequestId,
        scope: signupScope,
        providerOperationId: operationId,
        proof: "12345",
        now,
      }),
      { status: "rejected" },
    );
  });

  it("fails closed at the exact ten-minute challenge boundary", async () => {
    const { repository: challenges } = repository();
    const createdAt = new Date("2026-08-22T05:30:00.000Z");
    const operationId = await challenges.issue({
      authRequestId,
      scope: signupScope,
      code: "12345",
      now: createdAt,
    });

    assert.deepEqual(
      await challenges.verifyAndConsume({
        authRequestId,
        scope: signupScope,
        providerOperationId: operationId,
        proof: "12345",
        now: new Date(
          createdAt.getTime() + HOSTED_AUTH_EMAIL_CHALLENGE_TTL_MS,
        ),
      }),
      { status: "rejected" },
    );
  });
});
