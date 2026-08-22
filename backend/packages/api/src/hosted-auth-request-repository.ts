import { createHash } from "node:crypto";

import {
  HOSTED_AUTH_ACTIVE_TTL_SECONDS,
  HostedAuthActiveWindowSchema,
  HostedAuthMachineScopeSchema,
  HostedAuthPollTokenSchema,
  HostedAuthRequestIdSchema,
  HostedAuthRequestStateSchema,
  HostedAuthTerminalResultWindowSchema,
  terminalHostedAuthRequestStates,
  type HostedAuthMachineScope,
  type HostedAuthRequestState,
} from "@powerotp/contracts";
import type { Collection, Db } from "mongodb";

import type {
  HostedAuthRetentionWriter,
  HostedAuthTerminalRetentionDetails,
} from "./hosted-auth-retention-repository.js";
import { decryptString, encryptString, safeEqual } from "./security.js";

export const HOSTED_AUTH_RUNTIME_DATABASE_NAME = "powerotp_auth_runtime";
export const HOSTED_AUTH_REQUEST_COLLECTION_NAME = "hostedAuthRequests";

type TerminalState = (typeof terminalHostedAuthRequestStates)[number];
type TerminalResult = Readonly<Record<string, unknown>>;

export interface HostedAuthRequestDocument {
  _id: string;
  scope: HostedAuthMachineScope;
  state: HostedAuthRequestState;
  pollTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  purgeAt: Date;
  completedAt?: Date;
  resultExpiresAt?: Date;
  terminalResultEncrypted?: string;
}

export type HostedAuthRequestPoll =
  | Readonly<{ outcome: "not_found" | "invalid_poll_token" | "expired" }>
  | Readonly<{
      outcome: "active";
      authRequestId: string;
      state: HostedAuthRequestState;
      expiresAt: Date;
    }>
  | Readonly<{
      outcome: "terminal";
      authRequestId: string;
      state: TerminalState;
      completedAt: Date;
      resultExpiresAt: Date;
      result: TerminalResult;
    }>;

type RequestCollection = Pick<
  Collection<HostedAuthRequestDocument>,
  "createIndex" | "deleteOne" | "findOne" | "insertOne" | "updateOne"
>;

export function hostedAuthRuntimeDatabase(dbClient: { db(name: string): Db }): Db {
  return dbClient.db(HOSTED_AUTH_RUNTIME_DATABASE_NAME);
}

export async function ensureHostedAuthRequestIndexes(db: Db): Promise<void> {
  const requests = db.collection<HostedAuthRequestDocument>(
    HOSTED_AUTH_REQUEST_COLLECTION_NAME,
  );
  await Promise.all([
    requests.createIndex(
      { purgeAt: 1 },
      { expireAfterSeconds: 0, name: "purgeAt_ttl" },
    ),
    requests.createIndex(
      { "scope.projectId": 1, _id: 1 },
      { name: "project_request" },
    ),
  ]);
}

export function hashHostedAuthPollToken(pollToken: string): string {
  return createHash("sha256")
    .update(HostedAuthPollTokenSchema.parse(pollToken))
    .digest("base64url");
}

export class HostedAuthRequestRepository {
  private readonly requests: RequestCollection;

  constructor(
    db: Db,
    private readonly resultEncryptionKey: string,
    private readonly retention: HostedAuthRetentionWriter,
    collection?: RequestCollection,
  ) {
    if (resultEncryptionKey.length < 32) {
      throw new Error("Hosted auth result encryption key must be at least 32 characters");
    }
    this.requests =
      collection ??
      db.collection<HostedAuthRequestDocument>(
        HOSTED_AUTH_REQUEST_COLLECTION_NAME,
      );
  }

  async create(input: {
    authRequestId: string;
    scope: HostedAuthMachineScope;
    pollToken: string;
    createdAt?: Date;
  }): Promise<Readonly<{ authRequestId: string; expiresAt: Date }>> {
    const authRequestId = HostedAuthRequestIdSchema.parse(input.authRequestId);
    const scope = HostedAuthMachineScopeSchema.parse(input.scope);
    const createdAt = input.createdAt ?? new Date();
    const window = HostedAuthActiveWindowSchema.parse({
      createdAtMs: createdAt.getTime(),
      expiresAtMs:
        createdAt.getTime() + HOSTED_AUTH_ACTIVE_TTL_SECONDS * 1_000,
    });
    const expiresAt = new Date(window.expiresAtMs);

    await this.requests.insertOne({
      _id: authRequestId,
      scope,
      state: "created",
      pollTokenHash: hashHostedAuthPollToken(input.pollToken),
      createdAt,
      expiresAt,
      purgeAt: expiresAt,
    });
    return { authRequestId, expiresAt };
  }

  async publishTerminal(input: {
    authRequestId: string;
    projectId: string;
    state: TerminalState;
    completedAt: Date;
    result: TerminalResult;
    retention: HostedAuthTerminalRetentionDetails;
  }): Promise<boolean> {
    const authRequestId = HostedAuthRequestIdSchema.parse(input.authRequestId);
    const state = HostedAuthRequestStateSchema.parse(input.state);
    if (!terminalHostedAuthRequestStates.includes(state as TerminalState)) {
      throw new Error("A terminal hosted-auth state is required");
    }
    const window = HostedAuthTerminalResultWindowSchema.parse({
      completedAtMs: input.completedAt.getTime(),
      resultExpiresAtMs: input.completedAt.getTime() + 180_000,
    });
    const resultExpiresAt = new Date(window.resultExpiresAtMs);
    const terminalResultEncrypted = encryptString(
      JSON.stringify(input.result),
      this.resultEncryptionKey,
    );
    const request = await this.requests.findOne({
      _id: authRequestId,
      "scope.projectId": input.projectId,
      state: { $nin: terminalHostedAuthRequestStates },
      expiresAt: { $gt: input.completedAt },
    });
    if (
      !request ||
      terminalHostedAuthRequestStates.includes(request.state as TerminalState) ||
      request.expiresAt <= input.completedAt
    ) {
      return false;
    }

    await this.retention.retain({
      ...input.retention,
      authRequestId,
      projectId: request.scope.projectId,
      flow: request.scope.flow,
      outcome: state as TerminalState,
      createdAt: request.createdAt,
      completedAt: input.completedAt,
    });
    const update = await this.requests.updateOne(
      {
        _id: authRequestId,
        "scope.projectId": input.projectId,
        state: { $nin: terminalHostedAuthRequestStates },
        expiresAt: { $gt: input.completedAt },
      },
      {
        $set: {
          state,
          completedAt: input.completedAt,
          resultExpiresAt,
          terminalResultEncrypted,
          purgeAt: resultExpiresAt,
        },
      },
    );
    return update.modifiedCount === 1;
  }

  async poll(input: {
    authRequestId: string;
    projectId: string;
    flow: HostedAuthMachineScope["flow"];
    pollToken: string;
    now?: Date;
  }): Promise<HostedAuthRequestPoll> {
    const authRequestId = HostedAuthRequestIdSchema.parse(input.authRequestId);
    const pollTokenHash = hashHostedAuthPollToken(input.pollToken);
    const request = await this.requests.findOne({
      _id: authRequestId,
      "scope.projectId": input.projectId,
      "scope.flow": input.flow,
    });
    if (!request) return { outcome: "not_found" };

    if (!safeEqual(request.pollTokenHash, pollTokenHash)) {
      return { outcome: "invalid_poll_token" };
    }
    const now = input.now ?? new Date();
    if (now.getTime() >= request.purgeAt.getTime()) {
      await this.requests.deleteOne({ _id: request._id, purgeAt: request.purgeAt });
      return { outcome: "expired" };
    }
    if (!terminalHostedAuthRequestStates.includes(request.state as TerminalState)) {
      return {
        outcome: "active",
        authRequestId: request._id,
        state: request.state,
        expiresAt: request.expiresAt,
      };
    }
    if (
      !request.completedAt ||
      !request.resultExpiresAt ||
      !request.terminalResultEncrypted
    ) {
      throw new Error("Terminal hosted-auth request is missing its encrypted result");
    }
    return {
      outcome: "terminal",
      authRequestId: request._id,
      state: request.state as TerminalState,
      completedAt: request.completedAt,
      resultExpiresAt: request.resultExpiresAt,
      result: JSON.parse(
        decryptString(request.terminalResultEncrypted, this.resultEncryptionKey),
      ) as TerminalResult,
    };
  }
}
