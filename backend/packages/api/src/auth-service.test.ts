import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { AuthService, decryptEmail } from "./auth-service.js";
import type { ProductionConfig } from "./config.js";
import type { EmailService } from "./email.js";
import type {
  CustomerAccountDocument,
  EmailVerificationDocument,
  SessionDocument,
  UserDocument,
} from "./persistence.js";
import { hashToken } from "./security.js";

const config = {
  SESSION_HASH_SECRET: "session-hash-secret-at-least-32-characters!",
  PASSWORD_PEPPER: "password-pepper-at-least-32-characters!!!!!",
  PII_ENCRYPTION_KEY: "pii-encryption-key-at-least-32-characters!!",
  EMAIL_LOOKUP_HASH_SECRET: "email-lookup-hash-secret-at-least-32-chars!",
} as unknown as ProductionConfig;

/**
 * A minimal fake standing in for `users`/`sessions`/`emailVerifications`/
 * `customerAccounts` — same fake-collection convention used throughout
 * this package's other service tests; no real Mongo connection needed to
 * exercise `AuthService`'s own control flow.
 */
function createFakeDb() {
  const users = new Map<string, UserDocument>();
  const verifications = new Map<string, EmailVerificationDocument>();
  const customerAccounts = new Map<string, CustomerAccountDocument>();

  const usersCollection = {
    findOne: async (filter: Partial<UserDocument> & { _id?: string }) => {
      for (const user of users.values()) {
        if (filter._id !== undefined && user._id !== filter._id) continue;
        if (filter.emailLookupHash !== undefined && user.emailLookupHash !== filter.emailLookupHash) continue;
        if (filter.accountClass !== undefined && user.accountClass !== filter.accountClass) continue;
        return user;
      }
      return null;
    },
    insertOne: async (document: UserDocument) => {
      users.set(document._id, document);
    },
    updateOne: async (filter: { _id: string }, update: { $set?: Partial<UserDocument> }) => {
      const existing = users.get(filter._id);
      if (existing && update.$set) users.set(filter._id, { ...existing, ...update.$set });
    },
    deleteOne: async (filter: { _id: string }) => {
      users.delete(filter._id);
    },
  };
  const verificationsCollection = {
    insertOne: async (document: EmailVerificationDocument) => {
      verifications.set(document._id, document);
    },
    deleteMany: async () => {
      verifications.clear();
    },
    deleteOne: async (filter: { _id: string }) => {
      verifications.delete(filter._id);
    },
    findOneAndDelete: async (filter: { _id: string }) => {
      const found = verifications.get(filter._id);
      if (found) verifications.delete(filter._id);
      return found ?? null;
    },
  };
  const customerAccountsCollection = {
    insertOne: async (document: CustomerAccountDocument) => {
      customerAccounts.set(document._id, document);
    },
    deleteOne: async (filter: { _id: string }) => {
      customerAccounts.delete(filter._id);
    },
  };
  const sessionsCollection = {
    insertOne: async () => {},
  };

  const db = {
    collection: (name: string) => {
      if (name === "users") return usersCollection;
      if (name === "emailVerifications") return verificationsCollection;
      if (name === "customerAccounts") return customerAccountsCollection;
      if (name === "sessions") return sessionsCollection;
      throw new Error(`unexpected collection: ${name}`);
    },
  } as unknown as Db;

  return { db, users };
}

function fakeEmailService(): EmailService & { sentTo: string[] } {
  const sentTo: string[] = [];
  return {
    sentTo,
    async sendVerification(email) {
      sentTo.push(email);
    },
    async sendAdminAlert() {},
  };
}

describe("AuthService email encryption", () => {
  it("never stores the real email as plaintext, but decryptEmail recovers it", async () => {
    const { db, users } = createFakeDb();
    const auth = new AuthService(db, config, fakeEmailService());

    const { userId } = await auth.register({ email: "customer@example.com", password: "Correct-Horse-123!" });
    const stored = users.get(userId);

    assert.ok(stored);
    assert.notEqual(stored.emailEncrypted, "customer@example.com");
    assert.doesNotMatch(JSON.stringify(stored), /customer@example\.com/);
    assert.equal(decryptEmail(stored, config.PII_ENCRYPTION_KEY), "customer@example.com");
  });

  it("looks accounts up by a deterministic hash, never plaintext email, on re-registration", async () => {
    const { db } = createFakeDb();
    const auth = new AuthService(db, config, fakeEmailService());

    const first = await auth.register({ email: "customer@example.com", password: "Correct-Horse-123!" });
    const second = await auth.register({ email: "customer@example.com", password: "Different-Horse-456!" });

    assert.equal(first.userId, second.userId);
  });
});

describe("AuthService CSRF validation", () => {
  const token = "csrf-token";
  const session = {
    csrfHash: hashToken(token, config.SESSION_HASH_SECRET),
  } as SessionDocument;

  it("accepts the token bound to the authenticated session", () => {
    const { db } = createFakeDb();
    const auth = new AuthService(db, config, fakeEmailService());
    assert.doesNotThrow(() => auth.verifyCsrf(session, token));
  });

  it("rejects missing and mismatched tokens", () => {
    const { db } = createFakeDb();
    const auth = new AuthService(db, config, fakeEmailService());
    assert.throws(() => auth.verifyCsrf(session, undefined), /invalid_csrf_token/);
    assert.throws(() => auth.verifyCsrf(session, "wrong-token"), /invalid_csrf_token/);
  });
});
