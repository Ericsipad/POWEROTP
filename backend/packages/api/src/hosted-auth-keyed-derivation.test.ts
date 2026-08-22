import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { GenerateMacCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { Collection, Db } from "mongodb";

import {
  ProjectIdentityBindingRepository,
} from "./hosted-auth-durable-repository.js";
import type {
  ProjectIdentityBindingDocument,
} from "./hosted-auth-durable-schemas.js";
import {
  AwsKmsHostedAuthKeyedDerivationAuthority,
  HostedAuthKeyedDerivationService,
  type HostedAuthKeyedDerivationAuthority,
} from "./hosted-auth-keyed-derivation.js";

const person = `hpi_${"A".repeat(43)}`;
const bindingA = `pib_${"A".repeat(43)}`;
const bindingB = `pib_${"B".repeat(42)}A`;
const projectA = "project_scope_0001";
const projectB = "project_scope_0002";
const createdAt = new Date("2026-08-22T02:00:00.000Z");
const domains = [
  "project_user_id",
  "global_contact_link",
  "powerotp_pii_email",
  "powerotp_pii_phone",
  "didit_pii_email",
  "didit_pii_phone",
] as const;
type Domain = (typeof domains)[number];

class MemoryBindingCollection {
  readonly documents = new Map<string, ProjectIdentityBindingDocument>();

  async findOne(filter: {
    _id?: string;
    projectId?: string;
    hostedPersonIdentityId?: string;
  }) {
    const document = filter._id
      ? this.documents.get(filter._id)
      : [...this.documents.values()].find(
          (candidate) =>
            candidate.projectId === filter.projectId &&
            candidate.hostedPersonIdentityId ===
              filter.hostedPersonIdentityId,
        );
    return document ? structuredClone(document) : null;
  }

  async updateOne(
    filter: {
      _id?: string;
      projectId?: string;
      hostedPersonIdentityId?: string;
    },
    update: { $setOnInsert: ProjectIdentityBindingDocument },
  ) {
    const existing = await this.findOne(filter);
    if (existing) return { acknowledged: true, upsertedCount: 0 };
    this.documents.set(
      update.$setOnInsert._id,
      structuredClone(update.$setOnInsert),
    );
    return { acknowledged: true, upsertedCount: 1 };
  }
}

class MemoryAuthority implements HostedAuthKeyedDerivationAuthority {
  readonly current = new Map<Domain, number>(
    domains.map((domain) => [domain, 1]),
  );
  readonly secrets = new Map<string, Buffer>();
  deny = false;

  constructor() {
    for (const domain of domains) {
      this.secrets.set(`${domain}:1`, Buffer.alloc(32, domain.length));
      this.secrets.set(`${domain}:2`, Buffer.alloc(32, domain.length + 32));
    }
  }

  currentVersion(domain: Domain) {
    return this.current.get(domain)!;
  }

  availableVersions(domain: Domain) {
    return this.currentVersion(domain) === 1 ? [1] : [2, 1];
  }

  async generateMac(input: {
    domain: Domain;
    keyVersion: number;
    message: Uint8Array;
  }) {
    if (this.deny) throw new Error("KMS GenerateMac denied");
    return Uint8Array.from(
      createHmac(
        "sha256",
        this.secrets.get(`${input.domain}:${input.keyVersion}`)!,
      )
        .update(input.message)
        .digest(),
    );
  }
}

function fixture(input?: {
  collection?: MemoryBindingCollection;
  authority?: MemoryAuthority;
}) {
  const collection = input?.collection ?? new MemoryBindingCollection();
  const authority = input?.authority ?? new MemoryAuthority();
  const repository = new ProjectIdentityBindingRepository(
    {} as Db,
    collection as unknown as Collection<ProjectIdentityBindingDocument>,
  );
  return {
    authority,
    collection,
    repository,
    service: new HostedAuthKeyedDerivationService(repository, authority),
  };
}

describe("hosted-auth KMS keyed derivation", () => {
  it("domain-separates dedicated lookup secrets", async () => {
    const { service } = fixture();
    const value = "person@example.test";
    const global = await service.deriveLookup({
      purpose: "global_contact_link",
      canonicalLookupValue: value,
    });
    const powerotp = await service.deriveLookup({
      purpose: "powerotp_pii_email",
      canonicalLookupValue: value,
    });
    const didit = await service.deriveLookup({
      purpose: "didit_pii_email",
      canonicalLookupValue: value,
    });

    assert.equal(new Set([global.digest, powerotp.digest, didit.digest]).size, 3);
    assert.deepEqual(
      [global.purpose, powerotp.purpose, didit.purpose],
      ["global_contact_link", "powerotp_pii_email", "didit_pii_email"],
    );
  });

  it("derives unlinkable IDs across projects and persists only the public ID", async () => {
    const state = fixture();
    const first = await state.service.getOrCreateProjectBinding({
      bindingId: bindingA,
      projectId: projectA,
      hostedPersonIdentityId: person,
      createdAt,
    });
    const second = await state.service.getOrCreateProjectBinding({
      bindingId: bindingB,
      projectId: projectB,
      hostedPersonIdentityId: person,
      createdAt,
    });

    assert.notEqual(first.projectUserId, second.projectUserId);
    assert.equal(first.derivationVersion, 1);
    const persisted = JSON.stringify([...state.collection.documents.values()]);
    assert.doesNotMatch(persisted, /secret|pepper|lookupSecret|plaintextKey/);
    assert.match(persisted, /pusr_/);
  });

  it("keeps persisted project IDs immutable while rotating new derivations", async () => {
    const state = fixture();
    const original = await state.service.getOrCreateProjectBinding({
      bindingId: bindingA,
      projectId: projectA,
      hostedPersonIdentityId: person,
      createdAt,
    });
    state.authority.current.set("project_user_id", 2);
    state.authority.current.set("powerotp_pii_email", 2);

    const restarted = fixture({
      collection: state.collection,
      authority: state.authority,
    });
    const existing = await restarted.service.getOrCreateProjectBinding({
      bindingId: bindingB,
      projectId: projectA,
      hostedPersonIdentityId: person,
      createdAt: new Date(createdAt.getTime() + 1_000),
    });
    const lookupCandidates = await restarted.service.deriveLookupCandidates({
      purpose: "powerotp_pii_email",
      canonicalLookupValue: "person@example.test",
    });

    assert.equal(existing.projectUserId, original.projectUserId);
    assert.equal(existing.derivationVersion, 1);
    assert.deepEqual(
      lookupCandidates.map(({ keyVersion }) => keyVersion),
      [2, 1],
    );
    assert.notEqual(lookupCandidates[0]!.digest, lookupCandidates[1]!.digest);
    assert.equal(state.collection.documents.size, 1);
  });

  it("fails closed when KMS denies project or lookup derivation", async () => {
    const state = fixture();
    state.authority.deny = true;
    await assert.rejects(
      state.service.getOrCreateProjectBinding({
        bindingId: bindingA,
        projectId: projectA,
        hostedPersonIdentityId: person,
        createdAt,
      }),
      /KMS GenerateMac denied/,
    );
    await assert.rejects(
      state.service.deriveLookup({
        purpose: "powerotp_pii_email",
        canonicalLookupValue: "person@example.test",
      }),
      /KMS GenerateMac denied/,
    );
    assert.equal(state.collection.documents.size, 0);
  });

  it("uses only versioned dedicated AWS KMS HMAC keys", async () => {
    const commands: GenerateMacCommand[] = [];
    const client = {
      async send(command: GenerateMacCommand) {
        commands.push(command);
        return { Mac: Buffer.alloc(32, 7) };
      },
    } as unknown as KMSClient;
    const keys = Object.fromEntries(
      domains.map((domain, index) => [
        domain,
        {
          currentVersion: 1,
          keys: { 1: `arn:aws:kms:us-east-1:123456789012:key/${index}` },
        },
      ]),
    ) as ConstructorParameters<
      typeof AwsKmsHostedAuthKeyedDerivationAuthority
    >[0]["keys"];
    const authority = new AwsKmsHostedAuthKeyedDerivationAuthority({
      keys,
      client,
    });

    const mac = await authority.generateMac({
      domain: "powerotp_pii_email",
      keyVersion: 1,
      message: Buffer.from("canonical-value"),
    });

    assert.equal(mac.byteLength, 32);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]!.input.MacAlgorithm, "HMAC_SHA_256");
    assert.equal(
      commands[0]!.input.KeyId,
      "arn:aws:kms:us-east-1:123456789012:key/2",
    );
    assert.equal("secret" in commands[0]!.input, false);
    assert.throws(
      () =>
        new AwsKmsHostedAuthKeyedDerivationAuthority({
          keys: {
            ...keys,
            didit_pii_email: keys.powerotp_pii_email,
          },
          client,
        }),
      /dedicated KMS keys/,
    );
  });
});
