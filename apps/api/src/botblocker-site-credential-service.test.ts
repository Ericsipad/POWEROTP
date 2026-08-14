import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import type { BotBlockerSiteCredentialDocument } from "./botblocker-site-credential-persistence.js";
import {
  BotBlockerSiteCredentialError,
  BotBlockerSiteCredentialService,
} from "./botblocker-site-credential-service.js";
import type { AuditDocument } from "./persistence.js";
import { ProjectError } from "./project-service.js";
import { hashToken } from "./security.js";

const HASH_SECRET = "site-credential-secret-that-is-long-enough";
const scope = {
  customerId: "usr_owner",
  projectId: "prj_1234567890123456",
  siteId: "bbs_1234567890123456",
};

function fixture() {
  const credentials: BotBlockerSiteCredentialDocument[] = [];
  const audits: AuditDocument[] = [];
  const db = {
    collection(name: string) {
      if (name === "projects") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            filter._id === scope.projectId &&
            filter.customerId === scope.customerId
              ? {
                  _id: scope.projectId,
                  customerId: scope.customerId,
                  active: true,
                  allowedOrigins: ["https://customer.example"],
                }
              : null,
        };
      }
      if (name === "botblockerSites") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            filter.projectId === scope.projectId &&
            filter.customerId === scope.customerId
              ? { _id: scope.siteId, ...scope, enabled: false }
              : null,
        };
      }
      return {
        insertOne: async (document: AuditDocument) => {
          audits.push(document);
        },
      };
    },
  } as unknown as Db;
  const persistence = {
    findActiveByHash: async (credentialHash: string) =>
      credentials.find(
        (value) =>
          value.credentialHash === credentialHash && !value.revokedAt,
      ) ?? null,
    findByRotationKey: async (
      filter: { customerId: string; projectId: string },
      rotationKeyHash: string,
    ) =>
      credentials.find(
        (value) =>
          value.customerId === filter.customerId &&
          value.projectId === filter.projectId &&
          value.rotationKeyHash === rotationKeyHash,
      ) ?? null,
    rotate: async (
      credentialScope: typeof scope,
      input: Pick<
        BotBlockerSiteCredentialDocument,
        "credentialHash" | "rotationKeyHash" | "prefix" | "lastFour"
      >,
      now: Date,
    ) => {
      for (const value of credentials) {
        if (value.siteId === credentialScope.siteId && !value.revokedAt) {
          value.revokedAt = now;
        }
      }
      const document = {
        _id: `bbk_${credentials.length}abcdefghijklmnop`,
        ...credentialScope,
        ...input,
        createdAt: now,
      };
      credentials.push(document);
      return document;
    },
  };
  return {
    service: new BotBlockerSiteCredentialService(db, persistence, {
      BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET: HASH_SECRET,
    }),
    credentials,
    audits,
  };
}

describe("BotBlockerSiteCredentialService", () => {
  it("rotates an independent credential and returns the same value for a retry", async () => {
    const { service, credentials, audits } = fixture();
    const first = await service.rotate(
      scope.customerId,
      scope.projectId,
      "idem_1234567890123456",
      "192.0.2.10",
    );
    const retry = await service.rotate(
      scope.customerId,
      scope.projectId,
      "idem_1234567890123456",
    );

    assert.match(first.value, /^potp_bb_/);
    assert.equal(retry.value, first.value);
    assert.equal(credentials.length, 1);
    assert.equal(audits.length, 1);
    assert.notEqual(credentials[0]?.credentialHash, first.value);
  });

  it("authenticates only an active BotBlocker credential", async () => {
    const { service } = fixture();
    const created = await service.rotate(
      scope.customerId,
      scope.projectId,
      "idem_abcdefghijklmnop",
    );
    const authenticated = await service.authenticate(`Bearer ${created.value}`);
    assert.equal(authenticated.siteId, scope.siteId);
    assert.deepEqual(authenticated.allowedOrigins, [
      "https://customer.example",
    ]);
    await assert.rejects(
      service.authenticate("Bearer potp_sk_wrong"),
      BotBlockerSiteCredentialError,
    );
  });

  it("rejects cross-tenant rotation and missing configuration", async () => {
    const { service } = fixture();
    await assert.rejects(
      service.rotate(
        "usr_other",
        scope.projectId,
        "idem_1234567890123456",
      ),
      ProjectError,
    );
    const unavailable = new BotBlockerSiteCredentialService(
      { collection: () => ({}) } as unknown as Db,
      {
        findActiveByHash: async () => null,
        findByRotationKey: async () => null,
        rotate: async () => {
          throw new Error("not called");
        },
      },
      {},
    );
    await assert.rejects(
      unavailable.authenticate("Bearer potp_bb_missing"),
      (error: unknown) =>
        error instanceof BotBlockerSiteCredentialError &&
        error.code === "botblocker_credentials_unavailable" &&
        error.statusCode === 503,
    );
  });

  it("uses the dedicated hash secret", async () => {
    const { service, credentials } = fixture();
    const created = await service.rotate(
      scope.customerId,
      scope.projectId,
      "idem_hash_domain_1234",
    );
    assert.equal(
      credentials[0]?.credentialHash,
      hashToken(created.value, HASH_SECRET),
    );
  });
});
