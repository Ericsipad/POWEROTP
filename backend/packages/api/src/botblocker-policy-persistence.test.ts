import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SignedBotBlockerPolicyRelease } from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import {
  BotBlockerPolicyPersistence,
  ensureBotBlockerPolicyIndexes,
  type PolicyReleaseDocument,
} from "./botblocker-policy-persistence.js";
import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";

const NOW = 1_786_000_000_000;
const SITE_ID = "bbs_0123456789abcdef";
const scope = {
  customerId: "usr_0123456789abcdef",
  projectId: "prj_0123456789abcdef",
  siteId: SITE_ID,
};

interface CapturedIndex {
  keys: Record<string, number>;
  options?: Record<string, unknown>;
}

function release(version: number): SignedBotBlockerPolicyRelease {
  return {
    signatureStatus: "signed",
    keyId: "key_0123456789abcdef",
    signature: "a".repeat(86),
    audience: SITE_ID,
    nonce: `nonce_0123456789abcde${version}`,
    issuedAt: NOW,
    policy: {
      policyVersion: version,
      protocolVersion: 1,
      siteId: SITE_ID,
      activatesAt: NOW,
      expiresAt: NOW + 60_000,
      riskWeights: { modelVersion: "test_model", payload: {} },
      challengeMapping: [],
      edgeEndpoints: [],
      sensorVersion: "test_sensor",
      verificationKeys: [{ keyId: "key_0123456789abcdef" }],
      datasetVersions: {},
      revocationFilter: {
        filterVersion: 1,
        checksumSha256: "a".repeat(64),
      },
    },
  };
}

function transactionClient(): MongoClient {
  return {
    withSession: async (
      callback: (session: {
        withTransaction: (work: () => Promise<void>) => Promise<void>;
      }) => Promise<void>,
    ) => callback({ withTransaction: async (work) => work() }),
  } as unknown as MongoClient;
}

function dataDb() {
  const site: BotBlockerSiteDocument = {
    _id: SITE_ID,
    ...scope,
    webhookId: `bwh_${"A".repeat(120)}.${"B".repeat(43)}`,
    webhookSigningSecretEncrypted: "encrypted.secret.value",
    enabled: false,
    decisionTimeoutMs: 200,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  };
  const releases: PolicyReleaseDocument[] = [];
  const db = {
    collection(name: string) {
      if (name === "botblockerSites") {
        return {
          findOne: async (filter: { _id: string }) =>
            filter._id === site._id ? site : null,
          updateOne: async (
            filter: {
              _id: string;
              customerId: string;
              projectId: string;
            },
            update: {
              $set: {
                latestPolicyVersion: number;
                latestPolicyReleaseId: string;
              };
            },
          ) => {
            const next = update.$set.latestPolicyVersion;
            const matches =
              filter._id === site._id &&
              filter.customerId === site.customerId &&
              filter.projectId === site.projectId &&
              (site.latestPolicyVersion === undefined ||
                site.latestPolicyVersion < next);
            if (matches) Object.assign(site, update.$set);
            return { matchedCount: matches ? 1 : 0 };
          },
        };
      }
      return {
        insertOne: async (document: PolicyReleaseDocument) => {
          releases.push(document);
          return { insertedId: document._id };
        },
        findOne: async (
          filter: {
            customerId: string;
            projectId: string;
            siteId: string;
            activatesAt: { $lte: Date };
          },
        ) => releases
          .filter((row) =>
            row.customerId === filter.customerId &&
            row.projectId === filter.projectId &&
            row.siteId === filter.siteId &&
            row.activatesAt <= filter.activatesAt.$lte
          )
          .sort((left, right) => right.policyVersion - left.policyVersion)[0] ?? null,
      };
    },
  } as unknown as Db;
  return { db, site, releases };
}

describe("BotBlocker policy persistence", () => {
  it("creates scoped uniqueness and active-selection indexes", async () => {
    const captured: CapturedIndex[] = [];
    const db = {
      collection() {
        return {
          createIndex: async (
            keys: Record<string, number>,
            options?: Record<string, unknown>,
          ) => {
            captured.push(options ? { keys, options } : { keys });
            return "policy_index";
          },
        };
      },
    } as unknown as Db;

    await ensureBotBlockerPolicyIndexes(db);
    assert.deepEqual(captured, [
      {
        keys: {
          customerId: 1,
          projectId: 1,
          siteId: 1,
          policyVersion: 1,
        },
        options: { unique: true },
      },
      {
        keys: {
          customerId: 1,
          projectId: 1,
          siteId: 1,
          policyVersion: -1,
          activatesAt: -1,
        },
      },
    ]);
  });

  it("atomically advances the site head and inserts immutable releases", async () => {
    const state = dataDb();
    const persistence = new BotBlockerPolicyPersistence(
      state.db,
      transactionClient(),
    );
    assert.equal(
      await persistence.insertRelease(scope, release(2), new Date(NOW)),
      "inserted",
    );
    assert.equal(state.site.latestPolicyVersion, 2);
    assert.equal(state.releases.length, 1);

    assert.equal(
      await persistence.insertRelease(scope, release(2), new Date(NOW)),
      "policy_version_regression",
    );
    assert.equal(
      await persistence.insertRelease(scope, release(1), new Date(NOW)),
      "policy_version_regression",
    );
    assert.equal(state.releases.length, 1);
  });

  it("selects the highest activated version within full ownership scope", async () => {
    const state = dataDb();
    const persistence = new BotBlockerPolicyPersistence(
      state.db,
      transactionClient(),
    );
    await persistence.insertRelease(scope, release(1), new Date(NOW));
    await persistence.insertRelease(scope, release(2), new Date(NOW));

    assert.equal(
      (await persistence.findLatestActivatedRelease(scope, new Date(NOW)))
        ?.policyVersion,
      2,
    );
    assert.equal(
      await persistence.findLatestActivatedRelease(
        { ...scope, projectId: "prj_other_123456789" },
        new Date(NOW),
      ),
      null,
    );
  });
});
