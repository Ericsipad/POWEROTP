import { randomBytes, randomUUID } from "node:crypto";

import {
  HostedAuthProfileIdSchema,
  HostedPersonIdentityIdSchema,
  type HostedAuthIdentityDataMode,
} from "@powerotp/contracts";
import { z } from "zod";

import type {
  HostedAuthEncryptedFieldEnvelope,
  HostedAuthIdentityEncryptionService,
} from "./hosted-auth-identity-encryption.js";
import {
  HostedAuthLookupPurposeSchema,
  type HostedAuthKeyedDerivationService,
  type HostedAuthLookupDigest,
} from "./hosted-auth-keyed-derivation.js";

const EmailSchema = z.string().trim().toLowerCase().email().max(320);
const PhoneSchema = z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/);
const DiditContactReferenceSchema = z.string().trim().min(1).max(500);

const CreatePendingIdentityInputSchema = z.discriminatedUnion(
  "identityDataMode",
  [
    z
      .object({
        identityDataMode: z.literal("powerotp_pii"),
        channel: z.enum(["email", "phone"]),
        contact: z.string(),
      })
      .strict(),
    z
      .object({
        identityDataMode: z.literal("didit_pii"),
        channel: z.enum(["email", "phone"]),
        contact: z.string(),
        diditContactReference: DiditContactReferenceSchema,
      })
      .strict(),
  ],
);

export type CreatePendingHostedIdentityInput = z.input<
  typeof CreatePendingIdentityInputSchema
>;

export type PendingHostedIdentity = Readonly<{
  outcome: "created" | "existing";
  hostedPersonIdentityId: string;
  hostedAuthProfileId: string;
  identityDataMode: HostedAuthIdentityDataMode;
  channel: "email" | "phone";
}>;

export type ExistingHostedIdentity = Readonly<{
  hostedPersonIdentityId: string;
  hostedAuthProfileId: string;
}>;

export type PendingHostedIdentityWrite = Readonly<{
  hostedPersonIdentityId: string;
  hostedAuthProfileId: string;
  webauthnUserHandle: Buffer;
  identityDataMode: HostedAuthIdentityDataMode;
  channel: "email" | "phone";
  lookup: HostedAuthLookupDigest;
  maskedDestination: string;
  encryptedAttribute?: Readonly<{
    attributeId: string;
    envelope: HostedAuthEncryptedFieldEnvelope;
  }>;
  diditContactReference?: string;
  createdAt: Date;
}>;

export interface HostedAuthIdentitySagaRepository {
  findByLookupCandidates(input: {
    identityDataMode: HostedAuthIdentityDataMode;
    channel: "email" | "phone";
    candidates: readonly HostedAuthLookupDigest[];
  }): Promise<ExistingHostedIdentity | null>;
  createPending(
    input: PendingHostedIdentityWrite,
    candidates: readonly HostedAuthLookupDigest[],
  ): Promise<PendingHostedIdentity>;
}

type IdentityEncryption = Pick<
  HostedAuthIdentityEncryptionService,
  "compensatePendingIdentityKey" | "encryptField"
>;
type KeyedDerivation = Pick<
  HostedAuthKeyedDerivationService,
  "deriveLookupCandidates"
>;

export class HostedAuthIdentityCreationSaga {
  constructor(
    private readonly repository: HostedAuthIdentitySagaRepository,
    private readonly encryption: IdentityEncryption,
    private readonly derivation: KeyedDerivation,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createPending(
    unparsedInput: CreatePendingHostedIdentityInput,
  ): Promise<PendingHostedIdentity> {
    const input = CreatePendingIdentityInputSchema.parse(unparsedInput);
    const contact =
      input.channel === "email"
        ? EmailSchema.parse(input.contact)
        : PhoneSchema.parse(input.contact);
    const purpose = HostedAuthLookupPurposeSchema.parse(
      `${input.identityDataMode}_${input.channel}`,
    );
    const candidates = await this.derivation.deriveLookupCandidates({
      purpose,
      canonicalLookupValue: contact,
    });
    if (candidates.length === 0) {
      throw new Error("No hosted-auth lookup key version is available");
    }
    const existing = await this.repository.findByLookupCandidates({
      identityDataMode: input.identityDataMode,
      channel: input.channel,
      candidates,
    });
    if (existing) {
      return {
        outcome: "existing",
        ...existing,
        identityDataMode: input.identityDataMode,
        channel: input.channel,
      };
    }

    const hostedPersonIdentityId = HostedPersonIdentityIdSchema.parse(
      `hpi_${randomBytes(32).toString("base64url")}`,
    );
    const hostedAuthProfileId = HostedAuthProfileIdSchema.parse(
      `hap_${randomBytes(32).toString("base64url")}`,
    );
    let keyMayExist = false;
    try {
      keyMayExist = input.identityDataMode === "powerotp_pii";
      const encryptedAttribute =
        input.identityDataMode === "powerotp_pii"
          ? {
              attributeId: randomUUID(),
              envelope: await this.encryption.encryptField({
                hostedPersonIdentityId,
                fieldName: input.channel,
                schemaVersion: 1,
                purpose: "contact_authentication",
                plaintext: contact,
              }),
            }
          : undefined;
      const result = await this.repository.createPending(
        {
          hostedPersonIdentityId,
          hostedAuthProfileId,
          webauthnUserHandle: randomBytes(32),
          identityDataMode: input.identityDataMode,
          channel: input.channel,
          lookup: candidates[0]!,
          maskedDestination: maskContact(input.channel, contact),
          encryptedAttribute,
          diditContactReference:
            input.identityDataMode === "didit_pii"
              ? input.diditContactReference
              : undefined,
          createdAt: this.now(),
        },
        candidates,
      );
      if (result.outcome === "existing" && keyMayExist) {
        await this.encryption.compensatePendingIdentityKey(
          hostedPersonIdentityId,
        );
        keyMayExist = false;
      }
      return result;
    } catch (error) {
      if (keyMayExist) {
        try {
          await this.encryption.compensatePendingIdentityKey(
            hostedPersonIdentityId,
          );
        } catch (compensationError) {
          throw new AggregateError(
            [error, compensationError],
            "Hosted-auth identity creation and compensation failed",
          );
        }
      }
      throw error;
    }
  }
}

function maskContact(channel: "email" | "phone", contact: string): string {
  if (channel === "phone") return `***${contact.slice(-4)}`;
  const separator = contact.lastIndexOf("@");
  return `${contact[0]}***${contact.slice(separator)}`;
}
