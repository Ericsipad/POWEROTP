import type {
  BotBlockerProjectSetup,
  CreateProject,
  Project,
  UpdateProject,
  VerificationType,
} from "@powerotp/contracts";
import {
  DEFAULT_BOTBLOCKER_SITE_CONFIGURATION,
} from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import { createBotBlockerWebhookId } from "./botblocker-webhook.js";
import type { ProductionConfig } from "./config.js";
import {
  PLATFORM_ADMIN_USER_ID,
  type ApiKeyDocument,
  type AuditDocument,
  type ProjectDocument,
} from "./persistence.js";
import { projectVerificationUrl } from "./public-urls.js";
import {
  createId,
  createSecret,
  createSlug,
  encryptString,
  hashToken,
} from "./security.js";

const emptyByType: Record<VerificationType, number> = {
  call_reachability: 0,
  voice_code: 0,
  voice_challenge: 0,
  sms_code: 0,
  email_code: 0,
};

export interface ProjectStatsProvider {
  projectStats(projectId: string): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    byType: Record<VerificationType, number>;
  }>;
}

export class ProjectError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

export class ProjectService {
  readonly #projects;
  readonly #apiKeys;
  readonly #audits;
  readonly #botBlockerSites;

  constructor(
    db: Db,
    private readonly client: Pick<MongoClient, "withSession">,
    private readonly config: ProductionConfig,
    private readonly stats?: ProjectStatsProvider,
  ) {
    this.#projects = db.collection<ProjectDocument>("projects");
    this.#apiKeys = db.collection<ApiKeyDocument>("apiKeys");
    this.#audits = db.collection<AuditDocument>("auditEvents");
    this.#botBlockerSites =
      db.collection<BotBlockerSiteDocument>("botblockerSites");
  }

  async create(customerId: string, input: CreateProject, ip?: string) {
    const now = new Date();
    const project: ProjectDocument = {
      _id: createId("prj"),
      customerId,
      name: input.name,
      slug: createSlug(input.name),
      enabledMethods: input.enabledMethods,
      allowedOrigins: input.allowedOrigins,
      callbackUrl: input.callbackUrl,
      brandName: input.brandName,
      brandLogoUrl: input.brandLogoUrl,
      brandReplyToEmail: input.brandReplyToEmail,
      brandHtmlTemplate: input.brandHtmlTemplate,
      active: true,
      activatedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const apiKey = this.#newApiKey(project, customerId);
    const siteId = createId("bbs");
    const webhookSigningSecret = createSecret();
    const webhookId = createBotBlockerWebhookId(
      project._id,
      siteId,
      this.#requireWebhookEndpointSecret(),
    );
    const botBlockerSite: BotBlockerSiteDocument = {
      _id: siteId,
      projectId: project._id,
      customerId,
      webhookId,
      webhookSigningSecretEncrypted: encryptString(
        webhookSigningSecret,
        this.config.CONFIG_ENCRYPTION_KEY,
      ),
      ...DEFAULT_BOTBLOCKER_SITE_CONFIGURATION,
      createdAt: now,
      updatedAt: now,
    };
    const callbackSigningSecret = input.callbackUrl ? createSecret() : undefined;
    if (callbackSigningSecret) {
      project.callbackSecretEncrypted = encryptString(
        callbackSigningSecret,
        this.config.CONFIG_ENCRYPTION_KEY,
      );
    }

    const projectAudit = this.#auditDocument(
      customerId,
      "project.created",
      "project",
      project._id,
      now,
      ip,
    );
    const siteAudit = this.#auditDocument(
      customerId,
      "botblocker_site.created",
      "botblocker_site",
      siteId,
      now,
      ip,
    );
    const apiKeyAudit = this.#auditDocument(
      customerId,
      "api_key.created",
      "project",
      project._id,
      now,
      ip,
    );
    await this.client.withSession(async (session) => {
      await session.withTransaction(async () => {
        await this.#projects.insertOne(project, { session });
        await this.#apiKeys.insertOne(apiKey.document, { session });
        await this.#botBlockerSites.insertOne(botBlockerSite, { session });
        await this.#audits.insertMany(
          [projectAudit, apiKeyAudit, siteAudit],
          { session },
        );
      });
    });

    return {
      project: this.#toNewProjectResponse(project, apiKey.document),
      apiKey: apiKey.raw,
      callbackSigningSecret,
      botBlocker: {
        siteId,
        webhookId,
        webhookSigningSecret,
      } satisfies BotBlockerProjectSetup,
    };
  }

  async list(customerId: string) {
    const projects = await this.#projects
      .find({ customerId })
      .sort({ createdAt: -1 })
      .toArray();
    return Promise.all(projects.map((project) => this.#toResponse(project)));
  }

  async update(
    customerId: string,
    projectId: string,
    input: UpdateProject,
    ip?: string,
  ) {
    const changes: Partial<ProjectDocument> = { updatedAt: new Date() };
    if (input.name !== undefined) changes.name = input.name;
    if (input.enabledMethods !== undefined) {
      changes.enabledMethods = input.enabledMethods;
    }
    if (input.allowedOrigins !== undefined) {
      changes.allowedOrigins = input.allowedOrigins;
    }
    if (input.active !== undefined) changes.active = input.active;
    if (input.callbackUrl) changes.callbackUrl = input.callbackUrl;
    if (input.brandName) changes.brandName = input.brandName;
    if (input.brandLogoUrl) changes.brandLogoUrl = input.brandLogoUrl;
    if (input.brandReplyToEmail) changes.brandReplyToEmail = input.brandReplyToEmail;
    if (input.brandHtmlTemplate) changes.brandHtmlTemplate = input.brandHtmlTemplate;

    if (input.callbackUrl) {
      const existing = await this.#ownedProject(customerId, projectId);
      if (existing.callbackUrl !== input.callbackUrl) {
        throw new ProjectError("rotate_callback_secret_required", 409);
      }
    }

    const unsetFields: Partial<
      Record<
        | "callbackUrl"
        | "callbackSecretEncrypted"
        | "brandName"
        | "brandLogoUrl"
        | "brandReplyToEmail"
        | "brandHtmlTemplate",
        1
      >
    > = {};
    if (input.callbackUrl === null) {
      unsetFields.callbackUrl = 1;
      unsetFields.callbackSecretEncrypted = 1;
    }
    if (input.brandName === null) unsetFields.brandName = 1;
    if (input.brandLogoUrl === null) unsetFields.brandLogoUrl = 1;
    if (input.brandReplyToEmail === null) unsetFields.brandReplyToEmail = 1;
    if (input.brandHtmlTemplate === null) unsetFields.brandHtmlTemplate = 1;
    const unset = Object.keys(unsetFields).length > 0 ? unsetFields : undefined;
    const project = await this.#projects.findOneAndUpdate(
      { _id: projectId, customerId },
      { $set: changes, ...(unset ? { $unset: unset } : {}) },
      { returnDocument: "after" },
    );
    if (!project) throw new ProjectError("project_not_found", 404);
    await this.#audit(customerId, "project.updated", "project", projectId, ip);
    return this.#toResponse(project);
  }

  async rotateApiKey(customerId: string, projectId: string, ip?: string) {
    const project = await this.#ownedProject(customerId, projectId);
    const key = this.#newApiKey(project, customerId);
    const now = new Date();
    await this.#apiKeys.insertOne(key.document);
    await this.#apiKeys.updateMany(
      {
        _id: { $ne: key.document._id },
        projectId,
        customerId,
        revokedAt: { $exists: false },
      },
      { $set: { revokedAt: now } },
    );
    await this.#audit(customerId, "api_key.rotated", "project", projectId, ip);
    return key.raw;
  }

  async rotateCallback(
    customerId: string,
    projectId: string,
    callbackUrl: string,
    ip?: string,
  ) {
    await this.#ownedProject(customerId, projectId);
    const secret = createSecret();
    await this.#projects.updateOne(
      { _id: projectId, customerId },
      {
        $set: {
          callbackUrl,
          callbackSecretEncrypted: encryptString(
            secret,
            this.config.CONFIG_ENCRYPTION_KEY,
          ),
          updatedAt: new Date(),
        },
      },
    );
    await this.#audit(customerId, "callback.rotated", "project", projectId, ip);
    return secret;
  }

  async assertOwned(customerId: string, projectId: string) {
    await this.#ownedProject(customerId, projectId);
  }

  /**
   * Idempotently creates or refreshes the operator-owned project backing
   * the public "try it now" demo widget, at a fixed, predictable slug so
   * `DEMO_PROJECT_SLUG` can be committed as a stable value. Safe to call
   * repeatedly (e.g. after a disaster-recovery restore) since it upserts
   * on `slug` rather than minting a new project every time. Ownership is
   * attributed to the platform administrator account, not a customer,
   * because no customer should have visibility into anonymous demo
   * traffic.
   *
   * `activatedAt` is deliberately refreshed on every call (not just
   * `$setOnInsert`) so re-running this after the document was created any
   * other way (e.g. a manual insert, which is how this project was first
   * seeded — see `docs/AS_BUILT.md`) always leaves it as a genuine BSON
   * `Date`, which `#toResponse` requires. A manually-inserted document had
   * it stored as a plain string, which crashed `activatedAt.toISOString()`
   * here every time this endpoint ran until this self-healing fix.
   */
  async ensureDemoProject(slug: string, allowedOrigin: string, actorId: string) {
    const now = new Date();
    await this.#projects.updateOne(
      { slug },
      {
        $set: {
          name: "Live demo",
          enabledMethods: [
            "call_reachability",
            "voice_code",
            "voice_challenge",
            "sms_code",
          ] as VerificationType[],
          allowedOrigins: [allowedOrigin],
          active: true,
          activatedAt: now,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: createId("prj"),
          customerId: PLATFORM_ADMIN_USER_ID,
          slug,
          createdAt: now,
        },
      },
      { upsert: true },
    );
    const project = await this.#projects.findOne({ slug });
    if (!project) throw new ProjectError("project_not_found", 404);
    await this.#audit(actorId, "demo_project.ensured", "project", project._id);
    return this.#toResponse(project);
  }

  async #ownedProject(customerId: string, projectId: string) {
    const project = await this.#projects.findOne({ _id: projectId, customerId });
    if (!project) throw new ProjectError("project_not_found", 404);
    return project;
  }

  #newApiKey(project: ProjectDocument, customerId: string) {
    const raw = `potp_sk_${createSecret()}`;
    return {
      raw,
      document: {
        _id: createId("key"),
        projectId: project._id,
        customerId,
        keyHash: hashToken(raw, this.config.API_KEY_HASH_SECRET),
        prefix: raw.slice(0, 12),
        lastFour: raw.slice(-4),
        createdAt: new Date(),
      } satisfies ApiKeyDocument,
    };
  }

  #toNewProjectResponse(
    project: ProjectDocument,
    key: ApiKeyDocument,
  ): Project {
    return {
      id: project._id,
      name: project.name,
      slug: project.slug,
      apiUrl: projectVerificationUrl(this.config.PUBLIC_API_URL, project.slug),
      enabledMethods: project.enabledMethods,
      allowedOrigins: project.allowedOrigins,
      callbackUrl: project.callbackUrl,
      callbackConfigured: Boolean(
        project.callbackUrl && project.callbackSecretEncrypted,
      ),
      active: project.active,
      activatedAt: project.activatedAt.toISOString(),
      apiKeyPrefix: key.prefix,
      apiKeyLastFour: key.lastFour,
      brandName: project.brandName,
      brandLogoUrl: project.brandLogoUrl,
      brandReplyToEmail: project.brandReplyToEmail,
      brandHtmlTemplate: project.brandHtmlTemplate,
      stats: {
        total: 0,
        succeeded: 0,
        failed: 0,
        byType: { ...emptyByType },
      },
    };
  }

  async #toResponse(project: ProjectDocument): Promise<Project> {
    const key = await this.#apiKeys.findOne(
      { projectId: project._id, revokedAt: { $exists: false } },
      { sort: { createdAt: -1 } },
    );
    return {
      id: project._id,
      name: project.name,
      slug: project.slug,
      apiUrl: projectVerificationUrl(this.config.PUBLIC_API_URL, project.slug),
      enabledMethods: project.enabledMethods,
      allowedOrigins: project.allowedOrigins,
      callbackUrl: project.callbackUrl,
      callbackConfigured: Boolean(
        project.callbackUrl && project.callbackSecretEncrypted,
      ),
      active: project.active,
      activatedAt: project.activatedAt.toISOString(),
      apiKeyPrefix: key?.prefix,
      apiKeyLastFour: key?.lastFour,
      brandName: project.brandName,
      brandLogoUrl: project.brandLogoUrl,
      brandReplyToEmail: project.brandReplyToEmail,
      brandHtmlTemplate: project.brandHtmlTemplate,
      stats: this.stats
        ? await this.stats.projectStats(project._id)
        : { total: 0, succeeded: 0, failed: 0, byType: { ...emptyByType } },
    };
  }

  async #audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    ip?: string,
  ) {
    await this.#audits.insertOne(this.#auditDocument(
      actorId,
      action,
      targetType,
      targetId,
      new Date(),
      ip,
    ));
  }

  #auditDocument(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    occurredAt: Date,
    ip?: string,
  ): AuditDocument {
    return {
      _id: createId("aud"),
      actorId,
      action,
      targetType,
      targetId,
      occurredAt,
      ip,
    };
  }

  #requireWebhookEndpointSecret(): string {
    const secret = this.config.BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET;
    if (!secret) {
      throw new ProjectError("botblocker_webhook_unavailable", 503);
    }
    return secret;
  }
}
