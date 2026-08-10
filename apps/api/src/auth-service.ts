import type { AdminLogin, CustomerLogin, CustomerRegistration } from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { ProductionConfig } from "./config.js";
import type { EmailService } from "./email.js";
import { isIpAllowed } from "./ip-allowlist.js";
import {
  PLATFORM_ADMIN_USER_ID,
  type CustomerAccountDocument,
  type EmailVerificationDocument,
  type SessionDocument,
  type UserDocument,
} from "./persistence.js";
import {
  createId,
  createSecret,
  decryptString,
  encryptString,
  hashPassword,
  hashToken,
  safeEqual,
  verifyPassword,
} from "./security.js";

export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

/**
 * Decrypts an account's real email address — the only supported way to
 * read it, since `UserDocument#emailEncrypted` is never queried against
 * directly (use `emailLookupHash` for that). Exported as a plain function,
 * not an `AuthService` method, so callers outside this module (e.g.
 * `apps/web/lib/session-cookies.ts#sessionUser`) that already have a
 * `UserDocument` in hand don't need a whole `AuthService` instance just to
 * read one field.
 */
export function decryptEmail(user: UserDocument, piiEncryptionKey: string): string {
  return decryptString(user.emailEncrypted, piiEncryptionKey);
}

export interface AuthenticatedSession {
  user: UserDocument;
  csrfToken: string;
  sessionToken: string;
  expiresAt: Date;
}

export class AuthService {
  readonly #users;
  readonly #sessions;
  readonly #verifications;
  readonly #customerAccounts;
  readonly #dummyPasswordHash: Promise<string>;

  constructor(
    db: Db,
    private readonly config: ProductionConfig,
    private readonly email: EmailService,
  ) {
    this.#users = db.collection<UserDocument>("users");
    this.#sessions = db.collection<SessionDocument>("sessions");
    this.#verifications =
      db.collection<EmailVerificationDocument>("emailVerifications");
    this.#customerAccounts = db.collection<CustomerAccountDocument>("customerAccounts");
    this.#dummyPasswordHash = hashPassword(
      "POWEROTP-dummy-password-not-a-credential",
      config.PASSWORD_PEPPER,
    );
  }

  /**
   * Creates (or refreshes, if still unverified) a customer account and
   * queues its verification email. Returns the account's `userId` and
   * whether the email was already verified (silent, anti-enumeration
   * no-op) so callers like `POST /v1/auth/signup`
   * (`apps/web/app/v1/auth/signup/route.ts`) can decide whether to also
   * provision a first project/API key.
   */
  async register(input: CustomerRegistration): Promise<{ userId: string; alreadyVerified: boolean }> {
    const emailLookupHash = this.#emailLookupHash(input.email);
    const existing = await this.#users.findOne({ emailLookupHash });
    if (existing?.emailVerifiedAt) return { userId: existing._id, alreadyVerified: true };

    const userId = existing?._id ?? createId("usr");
    if (!existing) {
      const now = new Date();
      await this.#users.insertOne({
        _id: userId,
        emailEncrypted: encryptString(input.email, this.config.PII_ENCRYPTION_KEY),
        emailLookupHash,
        passwordHash: await hashPassword(input.password, this.config.PASSWORD_PEPPER),
        accountClass: "customer",
        createdAt: now,
        updatedAt: now,
      });
      await this.#customerAccounts.insertOne({ _id: userId, createdAt: now });
    } else {
      await this.#users.updateOne(
        { _id: userId, emailVerifiedAt: { $exists: false } },
        {
          $set: {
            passwordHash: await hashPassword(input.password, this.config.PASSWORD_PEPPER),
            updatedAt: new Date(),
          },
        },
      );
    }

    const token = createSecret();
    const tokenHash = hashToken(token, this.config.SESSION_HASH_SECRET);
    await this.#verifications.deleteMany({ userId });
    await this.#verifications.insertOne({
      _id: tokenHash,
      userId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });

    try {
      await this.email.sendVerification(input.email, token);
    } catch (error) {
      await this.#verifications.deleteOne({ _id: tokenHash });
      if (!existing) {
        await Promise.all([
          this.#users.deleteOne({ _id: userId }),
          this.#customerAccounts.deleteOne({ _id: userId }),
        ]);
      }
      throw error;
    }

    return { userId, alreadyVerified: false };
  }

  /** Returns the verified account's `userId` so callers (e.g.
   * `POST /v1/auth/verify-email`) can do post-verification bookkeeping
   * that belongs outside this module, like activating usage quotas. */
  async verifyEmail(token: string): Promise<{ userId: string }> {
    const tokenHash = hashToken(token, this.config.SESSION_HASH_SECRET);
    const verification = await this.#verifications.findOneAndDelete({
      _id: tokenHash,
      expiresAt: { $gt: new Date() },
    });
    if (!verification) throw new AuthError("invalid_or_expired_token", 400);

    await this.#users.updateOne(
      { _id: verification.userId },
      { $set: { emailVerifiedAt: new Date(), updatedAt: new Date() } },
    );
    return { userId: verification.userId };
  }

  async loginCustomer(input: CustomerLogin) {
    const user = await this.#users.findOne({
      emailLookupHash: this.#emailLookupHash(input.email),
      accountClass: "customer",
    });
    await this.#verifyCredentials(user, input.password);
    if (!user?.emailVerifiedAt) throw new AuthError("email_not_verified", 403);
    return this.#createSession(user, 12 * 60 * 60 * 1_000);
  }

  /**
   * The platform admin identity lives entirely in environment variables
   * (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_ALLOWED_IPS`), not a
   * registered database account — there is exactly one admin, matching
   * how this operator configures admin access on other projects. All
   * three checks fail with the same generic error so a caller cannot
   * distinguish "wrong IP" from "wrong password".
   */
  async loginAdmin(input: AdminLogin, clientIp: string | undefined) {
    if (!this.config.ADMIN_EMAIL || !this.config.ADMIN_PASSWORD) {
      throw new AuthError("invalid_credentials", 401);
    }
    if (!isIpAllowed(clientIp, this.config.ADMIN_ALLOWED_IPS)) {
      throw new AuthError("invalid_credentials", 401);
    }
    if (
      input.email !== this.config.ADMIN_EMAIL.toLowerCase() ||
      !safeEqual(input.password, this.config.ADMIN_PASSWORD)
    ) {
      throw new AuthError("invalid_credentials", 401);
    }

    const now = new Date();
    const adminEmail = this.config.ADMIN_EMAIL.toLowerCase();
    const user: UserDocument = {
      _id: PLATFORM_ADMIN_USER_ID,
      emailEncrypted: encryptString(adminEmail, this.config.PII_ENCRYPTION_KEY),
      emailLookupHash: this.#emailLookupHash(adminEmail),
      passwordHash: "",
      accountClass: "platform_admin",
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.#users.updateOne(
      { _id: user._id },
      {
        $set: {
          emailEncrypted: user.emailEncrypted,
          emailLookupHash: user.emailLookupHash,
          passwordHash: user.passwordHash,
          accountClass: user.accountClass,
          emailVerifiedAt: user.emailVerifiedAt,
          updatedAt: now,
        },
        $setOnInsert: { _id: user._id, createdAt: now },
      },
      { upsert: true },
    );

    return this.#createSession(user, 2 * 60 * 60 * 1_000);
  }

  async authenticate(sessionToken: string | undefined) {
    if (!sessionToken) throw new AuthError("authentication_required", 401);
    const session = await this.#sessions.findOne({
      _id: hashToken(sessionToken, this.config.SESSION_HASH_SECRET),
      expiresAt: { $gt: new Date() },
    });
    if (!session) throw new AuthError("authentication_required", 401);

    const user = await this.#users.findOne({ _id: session.userId });
    if (!user) throw new AuthError("authentication_required", 401);
    return { session, user };
  }

  verifyCsrf(session: SessionDocument, csrfToken: string | undefined) {
    if (
      !csrfToken ||
      !safeEqual(
        session.csrfHash,
        hashToken(csrfToken, this.config.SESSION_HASH_SECRET),
      )
    ) {
      throw new AuthError("invalid_csrf_token", 403);
    }
  }

  /**
   * Blocks creating a new verification interaction until the account's
   * email is verified — closes a real abuse gap: without this, a freshly
   * registered (but never-verified) account could still spend its free
   * monthly usage quota (`apps/api/src/usage-quota-service.ts`) purely by
   * holding the API key shown once at signup, never clicking the
   * activation link at all. Exempts the platform-admin-owned demo project.
   * Injected into `VerificationService` the same way as
   * `requireNonNegativeBalance`, so that module stays agnostic of exactly
   * how "verified" is defined.
   */
  async requireVerifiedEmail(userId: string): Promise<void> {
    if (userId === PLATFORM_ADMIN_USER_ID) return;
    const user = await this.#users.findOne({ _id: userId }, { projection: { emailVerifiedAt: 1 } });
    if (!user?.emailVerifiedAt) throw new AuthError("email_not_verified", 403);
  }

  async logout(sessionToken: string | undefined) {
    if (!sessionToken) return;
    await this.#sessions.deleteOne({
      _id: hashToken(sessionToken, this.config.SESSION_HASH_SECRET),
    });
  }

  /** Deterministic, so the same email always maps to the same lookup
   * value — this is what `users` is actually queried by (never plaintext
   * or `emailEncrypted`, which can't be queried against directly). Emails
   * are already lowercased/trimmed by `EmailSchema` before reaching here. */
  #emailLookupHash(email: string): string {
    return hashToken(email, this.config.EMAIL_LOOKUP_HASH_SECRET);
  }

  async #verifyCredentials(user: UserDocument | null, password: string) {
    const valid = user
      ? await verifyPassword(user.passwordHash, password, this.config.PASSWORD_PEPPER)
      : await verifyPassword(await this.#dummyPasswordHash, password, this.config.PASSWORD_PEPPER);
    if (!valid) throw new AuthError("invalid_credentials", 401);
  }

  async #createSession(user: UserDocument, lifetimeMs: number) {
    const sessionToken = createSecret();
    const csrfToken = createSecret();
    const expiresAt = new Date(Date.now() + lifetimeMs);
    await this.#sessions.insertOne({
      _id: hashToken(sessionToken, this.config.SESSION_HASH_SECRET),
      userId: user._id,
      csrfHash: hashToken(csrfToken, this.config.SESSION_HASH_SECRET),
      createdAt: new Date(),
      expiresAt,
    });
    return { user, csrfToken, sessionToken, expiresAt };
  }
}
