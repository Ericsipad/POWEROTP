import { GenerateMacCommand, KMSClient, type KMSClientConfig } from "@aws-sdk/client-kms";
import {
  HostedPersonIdentityIdSchema,
  ProjectIdentityBindingIdSchema,
  ProjectUserIdSchema,
} from "@powerotp/contracts";
import { z } from "zod";

import {
  ProjectIdentityBindingRepository,
} from "./hosted-auth-durable-repository.js";
import type {
  ProjectIdentityBindingRecord,
} from "./hosted-auth-durable-schemas.js";

const ProjectIdSchema = z.string().min(16).max(200);
const KeyVersionSchema = z.number().int().positive();
const LookupValueSchema = z.string().min(1).max(2_048);
const MAC_BYTES = 32;

export const HostedAuthLookupPurposeSchema = z.enum([
  "global_contact_link",
  "powerotp_pii_email",
  "powerotp_pii_phone",
  "didit_pii_email",
  "didit_pii_phone",
]);
export type HostedAuthLookupPurpose = z.infer<
  typeof HostedAuthLookupPurposeSchema
>;

const DERIVATION_DOMAINS = [
  "project_user_id",
  ...HostedAuthLookupPurposeSchema.options,
] as const;
type HostedAuthDerivationDomain = (typeof DERIVATION_DOMAINS)[number];

export interface HostedAuthKeyedDerivationAuthority {
  currentVersion(domain: HostedAuthDerivationDomain): number;
  availableVersions(domain: HostedAuthDerivationDomain): readonly number[];
  generateMac(input: {
    domain: HostedAuthDerivationDomain;
    keyVersion: number;
    message: Uint8Array;
  }): Promise<Uint8Array>;
}

type VersionedKmsKeys = Readonly<{
  currentVersion: number;
  keys: Readonly<Record<number, string>>;
}>;

export class AwsKmsHostedAuthKeyedDerivationAuthority
  implements HostedAuthKeyedDerivationAuthority
{
  private readonly client: KMSClient;
  private readonly keys: Readonly<Record<HostedAuthDerivationDomain, VersionedKmsKeys>>;

  constructor(input: {
    keys: Readonly<Record<HostedAuthDerivationDomain, VersionedKmsKeys>>;
    client?: KMSClient;
    clientConfig?: KMSClientConfig;
  }) {
    if (input.client && input.clientConfig) {
      throw new Error("Provide either a KMS client or client configuration");
    }
    const keyIds = new Set<string>();
    for (const domain of DERIVATION_DOMAINS) {
      const configuration = input.keys[domain];
      KeyVersionSchema.parse(configuration.currentVersion);
      if (!configuration.keys[configuration.currentVersion]) {
        throw new Error(`Current hosted-auth KMS key is unavailable for ${domain}`);
      }
      for (const [version, keyId] of Object.entries(configuration.keys)) {
        KeyVersionSchema.parse(Number(version));
        if (!keyId) throw new Error(`A hosted-auth KMS key ID is required for ${domain}`);
        if (keyIds.has(keyId)) {
          throw new Error("Hosted-auth keyed derivation domains require dedicated KMS keys");
        }
        keyIds.add(keyId);
      }
    }
    this.keys = input.keys;
    this.client = input.client ?? new KMSClient(input.clientConfig ?? {});
  }

  currentVersion(domain: HostedAuthDerivationDomain): number {
    return this.keys[domain].currentVersion;
  }

  availableVersions(domain: HostedAuthDerivationDomain): readonly number[] {
    const current = this.currentVersion(domain);
    return Object.keys(this.keys[domain].keys)
      .map(Number)
      .sort((left, right) =>
        left === current ? -1 : right === current ? 1 : right - left,
      );
  }

  async generateMac(input: {
    domain: HostedAuthDerivationDomain;
    keyVersion: number;
    message: Uint8Array;
  }): Promise<Uint8Array> {
    const keyVersion = KeyVersionSchema.parse(input.keyVersion);
    const keyId = this.keys[input.domain].keys[keyVersion];
    if (!keyId) throw new Error("Hosted-auth keyed derivation version is unavailable");
    const response = await this.client.send(
      new GenerateMacCommand({
        KeyId: keyId,
        MacAlgorithm: "HMAC_SHA_256",
        Message: input.message,
      }),
    );
    if (response.Mac?.byteLength !== MAC_BYTES) {
      throw new Error("KMS returned an invalid hosted-auth keyed derivation");
    }
    return Uint8Array.from(response.Mac);
  }
}

function projectUserMessage(
  hostedPersonIdentityId: string,
  projectId: string,
): Buffer {
  return Buffer.concat([
    Buffer.from(HostedPersonIdentityIdSchema.parse(hostedPersonIdentityId), "utf8"),
    Buffer.from([0]),
    Buffer.from(ProjectIdSchema.parse(projectId), "utf8"),
  ]);
}

function lookupMessage(
  purpose: HostedAuthLookupPurpose,
  canonicalLookupValue: string,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "powerotp_hosted_auth_lookup_v1",
      HostedAuthLookupPurposeSchema.parse(purpose),
      LookupValueSchema.parse(canonicalLookupValue),
    ]),
    "utf8",
  );
}

export type HostedAuthLookupDigest = Readonly<{
  purpose: HostedAuthLookupPurpose;
  keyVersion: number;
  digest: string;
}>;

export class HostedAuthKeyedDerivationService {
  constructor(
    private readonly bindings: ProjectIdentityBindingRepository,
    private readonly authority: HostedAuthKeyedDerivationAuthority,
  ) {}

  async getOrCreateProjectBinding(input: {
    bindingId: string;
    projectId: string;
    hostedPersonIdentityId: string;
    createdAt: Date;
  }): Promise<ProjectIdentityBindingRecord> {
    const projectId = ProjectIdSchema.parse(input.projectId);
    const hostedPersonIdentityId = HostedPersonIdentityIdSchema.parse(
      input.hostedPersonIdentityId,
    );
    const existing = await this.bindings.findByProjectPerson(
      projectId,
      hostedPersonIdentityId,
    );
    if (existing) return existing;

    const domain = "project_user_id";
    const derivationVersion = this.authority.currentVersion(domain);
    const mac = await this.authority.generateMac({
      domain,
      keyVersion: derivationVersion,
      message: projectUserMessage(hostedPersonIdentityId, projectId),
    });
    try {
      return await this.bindings.createOrGet({
        bindingId: ProjectIdentityBindingIdSchema.parse(input.bindingId),
        projectId,
        hostedPersonIdentityId,
        projectUserId: ProjectUserIdSchema.parse(
          `pusr_${Buffer.from(mac).toString("base64url")}`,
        ),
        status: "active",
        derivationVersion,
        createdAt: input.createdAt,
      });
    } finally {
      mac.fill(0);
    }
  }

  async deriveLookup(input: {
    purpose: HostedAuthLookupPurpose;
    canonicalLookupValue: string;
  }): Promise<HostedAuthLookupDigest> {
    const purpose = HostedAuthLookupPurposeSchema.parse(input.purpose);
    return this.deriveLookupVersion(
      purpose,
      input.canonicalLookupValue,
      this.authority.currentVersion(purpose),
    );
  }

  async deriveLookupCandidates(input: {
    purpose: HostedAuthLookupPurpose;
    canonicalLookupValue: string;
  }): Promise<readonly HostedAuthLookupDigest[]> {
    const purpose = HostedAuthLookupPurposeSchema.parse(input.purpose);
    return Promise.all(
      this.authority.availableVersions(purpose).map((keyVersion) =>
        this.deriveLookupVersion(
          purpose,
          input.canonicalLookupValue,
          keyVersion,
        ),
      ),
    );
  }

  private async deriveLookupVersion(
    purpose: HostedAuthLookupPurpose,
    canonicalLookupValue: string,
    keyVersion: number,
  ): Promise<HostedAuthLookupDigest> {
    const mac = await this.authority.generateMac({
      domain: purpose,
      keyVersion,
      message: lookupMessage(purpose, canonicalLookupValue),
    });
    try {
      return {
        purpose,
        keyVersion,
        digest: Buffer.from(mac).toString("base64url"),
      };
    } finally {
      mac.fill(0);
    }
  }
}
