import type { Db } from "mongodb";

import type { ProductionConfig } from "./config.js";
import { BotBlockerSiteCredentialError } from "./botblocker-errors.js";
import {
  BotBlockerSiteCredentialPersistence,
  type BotBlockerSiteCredentialDocument,
} from "./botblocker-site-credential-persistence.js";
import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import type {
  AuditDocument,
  ProjectDocument,
} from "./persistence.js";
import { ProjectError } from "./project-service.js";
import { createId, hashToken } from "./security.js";

type CredentialConfig = Pick<
  ProductionConfig,
  "BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET"
>;

export interface AuthenticatedBotBlockerSite {
  customerId: string;
  projectId: string;
  siteId: string;
  enabled: boolean;
  allowedOrigins: string[];
}

export { BotBlockerSiteCredentialError } from "./botblocker-errors.js";

export class BotBlockerSiteCredentialService {
  readonly #credentials: Pick<
    BotBlockerSiteCredentialPersistence,
    "findActiveByHash" | "findByRotationKey" | "rotate"
  >;
  readonly #sites;
  readonly #projects;
  readonly #audits;
  readonly #hashSecret: string | undefined;

  constructor(
    db: Db,
    credentials: Pick<
      BotBlockerSiteCredentialPersistence,
      "findActiveByHash" | "findByRotationKey" | "rotate"
    >,
    config: CredentialConfig,
  ) {
    this.#credentials = credentials;
    this.#sites = db.collection<BotBlockerSiteDocument>("botblockerSites");
    this.#projects = db.collection<ProjectDocument>("projects");
    this.#audits = db.collection<AuditDocument>("auditEvents");
    this.#hashSecret = config.BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET;
  }

  async rotate(
    customerId: string,
    projectId: string,
    idempotencyKey: string,
    ip?: string,
  ): Promise<{
    value: string;
    prefix: string;
    lastFour: string;
    createdAt: string;
  }> {
    const hashSecret = this.#requireHashSecret();
    const project = await this.#projects.findOne({ _id: projectId, customerId });
    if (!project) throw new ProjectError("project_not_found", 404);
    const site = await this.#sites.findOne({ projectId, customerId });
    if (!site) throw new ProjectError("botblocker_site_not_found", 404);

    if (idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      throw new BotBlockerSiteCredentialError(
        "idempotency_key_conflict",
        400,
      );
    }
    const rotationKeyHash = hashToken(
      `${customerId}\0${projectId}\0${idempotencyKey}`,
      hashSecret,
    );
    const raw = `potp_bb_${hashToken(`credential\0${rotationKeyHash}`, hashSecret)}`;
    const existing = await this.#credentials.findByRotationKey(
      { customerId, projectId },
      rotationKeyHash,
    );
    if (existing) {
      if (existing.revokedAt) {
        throw new BotBlockerSiteCredentialError(
          "idempotency_key_conflict",
          409,
        );
      }
      return {
        value: raw,
        prefix: existing.prefix,
        lastFour: existing.lastFour,
        createdAt: existing.createdAt.toISOString(),
      };
    }
    let document: BotBlockerSiteCredentialDocument;
    try {
      document = await this.#credentials.rotate(
        { customerId, projectId, siteId: site._id },
        {
          credentialHash: hashToken(raw, hashSecret),
          rotationKeyHash,
          prefix: raw.slice(0, 12),
          lastFour: raw.slice(-4),
        },
        new Date(),
      );
    } catch (error) {
      const concurrent = await this.#credentials.findByRotationKey(
        { customerId, projectId },
        rotationKeyHash,
      );
      if (!concurrent || concurrent.revokedAt) throw error;
      return {
        value: raw,
        prefix: concurrent.prefix,
        lastFour: concurrent.lastFour,
        createdAt: concurrent.createdAt.toISOString(),
      };
    }
    await this.#audit(customerId, document, ip);
    return {
      value: raw,
      prefix: document.prefix,
      lastFour: document.lastFour,
      createdAt: document.createdAt.toISOString(),
    };
  }

  async authenticate(
    authorizationHeader: string | undefined,
  ): Promise<AuthenticatedBotBlockerSite> {
    const match = /^Bearer\s+(potp_bb_\S+)$/.exec(authorizationHeader ?? "");
    if (!match) throw this.#authenticationError();
    const credential = await this.#credentials.findActiveByHash(
      hashToken(match[1]!, this.#requireHashSecret()),
    );
    if (!credential) throw this.#authenticationError();

    const [site, project] = await Promise.all([
      this.#sites.findOne({
        _id: credential.siteId,
        customerId: credential.customerId,
        projectId: credential.projectId,
      }),
      this.#projects.findOne({
        _id: credential.projectId,
        customerId: credential.customerId,
        active: true,
      }),
    ]);
    if (!site || !project) throw this.#authenticationError();
    return {
      customerId: credential.customerId,
      projectId: credential.projectId,
      siteId: credential.siteId,
      enabled: site.enabled,
      allowedOrigins: project.allowedOrigins,
    };
  }

  #requireHashSecret(): string {
    if (!this.#hashSecret) {
      throw new BotBlockerSiteCredentialError(
        "botblocker_credentials_unavailable",
        503,
      );
    }
    return this.#hashSecret;
  }

  #authenticationError() {
    return new BotBlockerSiteCredentialError("authentication_required", 401);
  }

  async #audit(
    actorId: string,
    credential: BotBlockerSiteCredentialDocument,
    ip?: string,
  ) {
    await this.#audits.insertOne({
      _id: createId("aud"),
      actorId,
      action: "botblocker_site_credential.rotated",
      targetType: "botblocker_site",
      targetId: credential.siteId,
      occurredAt: credential.createdAt,
      ip,
      details: {
        credentialId: credential._id,
        prefix: credential.prefix,
        lastFour: credential.lastFour,
      },
    });
  }
}
