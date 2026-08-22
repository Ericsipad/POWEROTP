import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import {
  DecryptCommand,
  EncryptCommand,
  KMSClient,
  type KMSClientConfig,
} from "@aws-sdk/client-kms";
import { HostedPersonIdentityIdSchema } from "@powerotp/contracts";
import { z } from "zod";

import { WrappedIdentityKeyRepository } from "./hosted-auth-durable-repository.js";

const DEK_BYTES = 32;
const NONCE_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;
const IDENTITY_DEK_ENCRYPTION_CONTEXT_PURPOSE = "hosted_auth_identity_dek";

const CanonicalCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/);
export const HostedAuthEncryptedFieldNameSchema = z.enum([
  "email",
  "phone",
  "derived_date_of_birth",
]);

function canonicalBase64UrlSchema(bytes?: number) {
  return z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, "Expected unpadded base64url")
    .refine((value) => {
      const decoded = Buffer.from(value, "base64url");
      return (
        (bytes === undefined ? decoded.length > 0 : decoded.length === bytes) &&
        decoded.toString("base64url") === value
      );
    }, "Expected canonical base64url");
}

export const HostedAuthEncryptedFieldEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    fieldName: HostedAuthEncryptedFieldNameSchema,
    purpose: CanonicalCodeSchema,
    keyVersion: z.literal(1),
    nonce: canonicalBase64UrlSchema(NONCE_BYTES),
    ciphertext: canonicalBase64UrlSchema(),
    authenticationTag: canonicalBase64UrlSchema(AUTHENTICATION_TAG_BYTES),
  })
  .strict();

export type HostedAuthEncryptedFieldEnvelope = z.infer<
  typeof HostedAuthEncryptedFieldEnvelopeSchema
>;

export interface HostedAuthIdentityKeyAuthority {
  readonly kmsKeyVersion: string;
  wrapDek(input: {
    hostedPersonIdentityId: string;
    plaintextDek: Uint8Array;
  }): Promise<string>;
  unwrapDek(input: {
    hostedPersonIdentityId: string;
    wrappedDekCiphertext: string;
  }): Promise<Uint8Array>;
}

function identityDekEncryptionContext(hostedPersonIdentityId: string) {
  return {
    hostedPersonIdentityId,
    powerotpPurpose: IDENTITY_DEK_ENCRYPTION_CONTEXT_PURPOSE,
  };
}

export class AwsKmsHostedAuthIdentityKeyAuthority
  implements HostedAuthIdentityKeyAuthority
{
  readonly kmsKeyVersion: string;
  private readonly client: KMSClient;

  constructor(input: {
    keyId: string;
    kmsKeyVersion: string;
    client?: KMSClient;
    clientConfig?: KMSClientConfig;
  }) {
    if (!input.keyId) throw new Error("A hosted-auth KMS key ID is required");
    this.kmsKeyVersion = CanonicalCodeSchema.parse(input.kmsKeyVersion);
    this.client = input.client ?? new KMSClient(input.clientConfig ?? {});
    if (input.client && input.clientConfig) {
      throw new Error("Provide either a KMS client or client configuration");
    }
    this.keyId = input.keyId;
  }

  private readonly keyId: string;

  async wrapDek(input: {
    hostedPersonIdentityId: string;
    plaintextDek: Uint8Array;
  }): Promise<string> {
    const hostedPersonIdentityId = HostedPersonIdentityIdSchema.parse(
      input.hostedPersonIdentityId,
    );
    if (input.plaintextDek.byteLength !== DEK_BYTES) {
      throw new Error("Hosted-auth identity DEKs must be 256 bits");
    }
    const response = await this.client.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: input.plaintextDek,
        EncryptionContext: identityDekEncryptionContext(hostedPersonIdentityId),
      }),
    );
    if (!response.CiphertextBlob?.byteLength) {
      throw new Error("KMS returned no wrapped hosted-auth identity key");
    }
    return Buffer.from(response.CiphertextBlob).toString("base64url");
  }

  async unwrapDek(input: {
    hostedPersonIdentityId: string;
    wrappedDekCiphertext: string;
  }): Promise<Uint8Array> {
    const hostedPersonIdentityId = HostedPersonIdentityIdSchema.parse(
      input.hostedPersonIdentityId,
    );
    const wrappedDekCiphertext = canonicalBase64UrlSchema().parse(
      input.wrappedDekCiphertext,
    );
    const response = await this.client.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: Buffer.from(wrappedDekCiphertext, "base64url"),
        EncryptionContext: identityDekEncryptionContext(hostedPersonIdentityId),
      }),
    );
    if (response.Plaintext?.byteLength !== DEK_BYTES) {
      throw new Error("KMS returned an invalid hosted-auth identity key");
    }
    const plaintextDek = Uint8Array.from(response.Plaintext);
    response.Plaintext.fill(0);
    return plaintextDek;
  }
}

function fieldAssociatedData(input: {
  hostedPersonIdentityId: string;
  fieldName: string;
  schemaVersion: number;
  purpose: string;
}): Buffer {
  return Buffer.from(
    JSON.stringify([
      HostedPersonIdentityIdSchema.parse(input.hostedPersonIdentityId),
      HostedAuthEncryptedFieldNameSchema.parse(input.fieldName),
      z.number().int().positive().parse(input.schemaVersion),
      CanonicalCodeSchema.parse(input.purpose),
    ]),
    "utf8",
  );
}

export class HostedAuthIdentityEncryptionService {
  constructor(
    private readonly keys: WrappedIdentityKeyRepository,
    private readonly keyAuthority: HostedAuthIdentityKeyAuthority,
  ) {
    CanonicalCodeSchema.parse(keyAuthority.kmsKeyVersion);
  }

  async encryptField(input: {
    hostedPersonIdentityId: string;
    fieldName: z.infer<typeof HostedAuthEncryptedFieldNameSchema>;
    schemaVersion: number;
    purpose: string;
    plaintext: string;
  }): Promise<HostedAuthEncryptedFieldEnvelope> {
    if (!input.plaintext) {
      throw new Error("Hosted-auth encrypted fields cannot be empty");
    }
    const dek = await this.loadOrCreateDek(input.hostedPersonIdentityId);
    try {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", dek, nonce);
      cipher.setAAD(fieldAssociatedData(input));
      const ciphertext = Buffer.concat([
        cipher.update(input.plaintext, "utf8"),
        cipher.final(),
      ]);
      return HostedAuthEncryptedFieldEnvelopeSchema.parse({
        schemaVersion: input.schemaVersion,
        fieldName: input.fieldName,
        purpose: input.purpose,
        keyVersion: 1,
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        authenticationTag: cipher.getAuthTag().toString("base64url"),
      });
    } finally {
      dek.fill(0);
    }
  }

  async decryptField(input: {
    hostedPersonIdentityId: string;
    envelope: HostedAuthEncryptedFieldEnvelope;
  }): Promise<string> {
    const envelope = HostedAuthEncryptedFieldEnvelopeSchema.parse(
      input.envelope,
    );
    const dek = await this.loadDek(input.hostedPersonIdentityId);
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        dek,
        Buffer.from(envelope.nonce, "base64url"),
      );
      decipher.setAAD(
        fieldAssociatedData({
          hostedPersonIdentityId: input.hostedPersonIdentityId,
          fieldName: envelope.fieldName,
          schemaVersion: envelope.schemaVersion,
          purpose: envelope.purpose,
        }),
      );
      decipher.setAuthTag(
        Buffer.from(envelope.authenticationTag, "base64url"),
      );
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } finally {
      dek.fill(0);
    }
  }

  private async loadOrCreateDek(
    hostedPersonIdentityIdInput: string,
  ): Promise<Buffer> {
    const hostedPersonIdentityId = HostedPersonIdentityIdSchema.parse(
      hostedPersonIdentityIdInput,
    );
    const existing = await this.keys.findActive(hostedPersonIdentityId);
    if (existing) {
      return this.unwrapRecord(hostedPersonIdentityId, existing);
    }

    const generatedDek = randomBytes(DEK_BYTES);
    try {
      const wrappedDekCiphertext = await this.keyAuthority.wrapDek({
        hostedPersonIdentityId,
        plaintextDek: generatedDek,
      });
      const persisted = await this.keys.createActive({
        hostedPersonIdentityId,
        kmsKeyVersion: this.keyAuthority.kmsKeyVersion,
        wrappedDekCiphertext,
        status: "active",
        createdAt: new Date(),
      });
      if (persisted.outcome === "inserted") {
        return Buffer.from(generatedDek);
      }
      return this.unwrapRecord(hostedPersonIdentityId, persisted.record);
    } finally {
      generatedDek.fill(0);
    }
  }

  private async loadDek(hostedPersonIdentityIdInput: string): Promise<Buffer> {
    const hostedPersonIdentityId = HostedPersonIdentityIdSchema.parse(
      hostedPersonIdentityIdInput,
    );
    const record = await this.keys.findActive(hostedPersonIdentityId);
    if (!record) {
      throw new Error("Hosted-auth identity key is unavailable");
    }
    return this.unwrapRecord(hostedPersonIdentityId, record);
  }

  private async unwrapRecord(
    hostedPersonIdentityId: string,
    record: {
      kmsKeyVersion: string;
      wrappedDekCiphertext?: string;
    },
  ): Promise<Buffer> {
    if (
      record.kmsKeyVersion !== this.keyAuthority.kmsKeyVersion ||
      !record.wrappedDekCiphertext
    ) {
      throw new Error("Hosted-auth identity key version is unavailable");
    }
    const plaintextDek = await this.keyAuthority.unwrapDek({
      hostedPersonIdentityId,
      wrappedDekCiphertext: record.wrappedDekCiphertext,
    });
    if (plaintextDek.byteLength !== DEK_BYTES) {
      throw new Error("Hosted-auth identity DEKs must be 256 bits");
    }
    const dek = Buffer.from(plaintextDek);
    plaintextDek.fill(0);
    return dek;
  }
}
