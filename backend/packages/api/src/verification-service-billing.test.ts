import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import type { ChallengeService } from "./challenge-service.js";
import type { VerificationRequestDocument } from "./verification-persistence.js";
import { VerificationService } from "./verification-service.js";

describe("VerificationService billing trigger", () => {
  it("charges an email interaction when Brevo-accepted delivery finishes", async () => {
    let request: VerificationRequestDocument = {
      _id: "int_email_1",
      projectId: "prj_1",
      customerId: "usr_1",
      type: "email_code",
      targetNumber: "user@example.com",
      state: "dispatching",
      sequence: 1,
      correlationId: "req_1",
      browserResponse: false,
      emailSent: true,
      freeQuotaCovered: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const events: unknown[] = [];
    const requests = {
      findOne: async () => request,
      findOneAndUpdate: async (
        filter: { state: string; sequence: number },
        update: { $set: Partial<VerificationRequestDocument> },
      ) => {
        if (request.state !== filter.state || request.sequence !== filter.sequence) return null;
        request = { ...request, ...update.$set };
        return request;
      },
      updateOne: async () => {},
    };
    const db = {
      collection: (name: string) => {
        if (name === "verificationRequests") return requests;
        if (name === "verificationEvents") {
          return { insertOne: async (event: unknown) => events.push(event) };
        }
        return {};
      },
    } as unknown as Db;
    const charged: VerificationRequestDocument[] = [];
    let reconciled = false;
    const service = new VerificationService(
      db,
      { PUBLIC_API_URL: "https://api.powerotp.com", CONFIG_ENCRYPTION_KEY: "unused" },
      {} as ChallengeService,
      async () => {},
      async () => {},
      async () => {},
      async () => {
        reconciled = true;
      },
      async () => {},
      async (verification) => {
        charged.push(verification);
      },
    );

    assert.equal(await service.transition(request._id, "awaiting_response", "code_sent"), true);
    assert.equal(charged.length, 1);
    assert.equal(charged[0]?.emailSent, true);
    assert.equal(reconciled, false);
    assert.equal(events.length, 1);
    assert.ok(request.billingPendingAt);
  });
});
