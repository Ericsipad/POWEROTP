import type { AdminLogin, CustomerLogin, CustomerRegistration } from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { ProductionConfig } from "./config.js";
import type { EmailService } from "./email.js";
import { isIpAllowed } from "./ip-allowlist.js";
import {
  PLATFORM_ADMIN_USER_ID,
  type EmailVerificationDocument,
  type SessionDocument,
  type UserDocument,
} from "./persistence.js";
import {
  createId,
  createSecret,
  hashPassword,
  hashToken,
  safeEqual,
  verifyPassword,
} from "./security.js";

const dummyPasswordHash = hashPassword("POWEROTP-dummy-password-not-a-credential");

export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
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

  constructor(
    db: Db,
    private readonly config: ProductionConfig,
    private readonly email: EmailService,
  ) {
    this.#users = db.collection<UserDocument>("users");
    this.#sessions = db.collection<SessionDocument>("sessions");
    this.#verifications =
      db.collection<EmailVerificationDocument>("emailVerifications");
    this.#customerAccounts = db.collection<{
      _id: string;
      createdAt: Date;
    }>("customerAccounts");
  }

  async register(input: CustomerRegistration) {
    const existing = await this.#users.findOne({ email: input.email });
    if (existing?.emailVerifiedAt) return;

    const userId = existing?._id ?? createId("usr");
    if (!existing) {
      const now = new Date();
      await this.#users.insertOne({
        _id: userId,
        email: input.email,
        passwordHash: await hashPassword(input.password),
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
            passwordHash: await hashPassword(input.password),
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
  }

  async verifyEmail(token: string) {
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
  }

  async loginCustomer(input: CustomerLogin) {
    const user = await this.#users.findOne({
      email: input.email,
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
    const user: UserDocument = {
      _id: PLATFORM_ADMIN_USER_ID,
      email: this.config.ADMIN_EMAIL.toLowerCase(),
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
          email: user.email,
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

  async logout(sessionToken: string | undefined) {
    if (!sessionToken) return;
    await this.#sessions.deleteOne({
      _id: hashToken(sessionToken, this.config.SESSION_HASH_SECRET),
    });
  }

  async #verifyCredentials(user: UserDocument | null, password: string) {
    const valid = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyPassword(await dummyPasswordHash, password);
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
