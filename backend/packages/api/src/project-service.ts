import type {
  BotBlockerProjectSetup,
  CreateProject,
  HostedAuthIdentityDataMode,
  HostedAuthProjectSettings,
  HostedAuthReturnUrls,
  Project,
  ProjectCreated,
  UpdateHostedAuthProjectSettings,
  UpdateProject,
  VerificationType,
} from "@powerotp/contracts";
import {
  DEFAULT_HOSTED_AUTH_PROJECT_SETTINGS,
  DEFAULT_BOTBLOCKER_SITE_CONFIGURATION,
  ProjectIdentifierStringSchema,
} from "@powerotp/contracts";
import type { Db, MongoClient } from "mongodb";

import type { BotBlockerSiteDocument } from "./botblocker-site-persistence.js";
import { createBotBlockerWebhookId } from "./botblocker-webhook.js";
import type { ProductionConfig } from "./config.js";
import {
  HOSTED_AUTH_DEPLOYMENTS,
  type HostedAuthDeploymentEnvironment,
} from "./hosted-auth-realms.js";
import {
  PLATFORM_ADMIN_USER_ID,
  type ApiKeyDocument,
  type AuditDocument,
  type CustomerProjectDocument,
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
    private readonly hostedAuthEnvironment: HostedAuthDeploymentEnvironment,
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
    const slug = createSlug(input.name);
    const hostedAuth = createHostedAuthProjectConfiguration(
      this.hostedAuthEnvironment,
      input.identityDataMode,
      slug,
    );
    const project: CustomerProjectDocument = {
      _id: createId("prj"),
      customerId,
      name: input.name,
      slug,
      ...hostedAuth,
      authSettings: structuredClone(DEFAULT_HOSTED_AUTH_PROJECT_SETTINGS),
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
      otpMethodMarkers: DEFAULT_BOTBLOCKER_SITE_CONFIGURATION.otpMethodMarkers.map(
        (marker) => ({ ...marker }),
      ),
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
    return Promise.all(
      projects.map((project) =>
        this.#toResponse(this.#requireCustomerProject(project)),
      ),
    );
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
    return this.#toResponse(this.#requireCustomerProject(project));
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

  async getAuthSettings(
    customerId: string,
    projectId: string,
  ): Promise<HostedAuthProjectSettings> {
    return structuredClone((await this.#ownedProject(customerId, projectId)).authSettings);
  }

  async updateAuthSettings(
    customerId: string,
    projectId: string,
    input: UpdateHostedAuthProjectSettings,
    ip?: string,
  ): Promise<HostedAuthProjectSettings> {
    const existing = await this.#ownedProject(customerId, projectId);
    const authSettings = {
      ...existing.authSettings,
      ...input,
    };
    const updated = await this.#projects.findOneAndUpdate(
      { _id: projectId, customerId },
      { $set: { authSettings, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!updated) throw new ProjectError("project_not_found", 404);
    await this.#audit(
      customerId,
      "hosted_auth.settings_updated",
      "project",
      projectId,
      ip,
    );
    return structuredClone(this.#requireCustomerProject(updated).authSettings);
  }

  async getAuthReturnUrls(
    customerId: string,
    projectId: string,
  ): Promise<HostedAuthReturnUrls> {
    const urls = (await this.#ownedProject(customerId, projectId)).authReturnUrls;
    if (!urls) throw new ProjectError("auth_return_urls_not_configured", 404);
    return { ...urls };
  }

  async replaceAuthReturnUrls(
    customerId: string,
    projectId: string,
    input: HostedAuthReturnUrls,
    ip?: string,
  ): Promise<HostedAuthReturnUrls> {
    await this.#ownedProject(customerId, projectId);
    const authReturnUrls = canonicalizeHostedAuthReturnUrls(
      input,
      this.hostedAuthEnvironment,
    );
    const updated = await this.#projects.findOneAndUpdate(
      { _id: projectId, customerId },
      { $set: { authReturnUrls, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!updated) throw new ProjectError("project_not_found", 404);
    await this.#audit(
      customerId,
      "hosted_auth.return_urls_replaced",
      "project",
      projectId,
      ip,
    );
    return { ...authReturnUrls };
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
    return { slug: project.slug };
  }

  async #ownedProject(customerId: string, projectId: string) {
    const project = await this.#projects.findOne({ _id: projectId, customerId });
    if (!project) throw new ProjectError("project_not_found", 404);
    return this.#requireCustomerProject(project);
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
    project: CustomerProjectDocument,
    key: ApiKeyDocument,
  ): ProjectCreated["project"] {
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
      identityDataMode: project.identityDataMode,
      identifierString: project.identifierString,
      authRealm: project.authRealm,
      rpId: project.rpId,
      signupHostedUrl: project.signupHostedUrl,
      signinHostedUrl: project.signinHostedUrl,
      authSettings: structuredClone(project.authSettings),
      authReturnUrls: project.authReturnUrls ? { ...project.authReturnUrls } : undefined,
      stats: {
        total: 0,
        succeeded: 0,
        failed: 0,
        byType: { ...emptyByType },
      },
    };
  }

  async #toResponse(project: CustomerProjectDocument): Promise<Project> {
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
      identityDataMode: project.identityDataMode,
      identifierString: project.identifierString,
      authRealm: project.authRealm,
      rpId: project.rpId,
      signupHostedUrl: project.signupHostedUrl,
      signinHostedUrl: project.signinHostedUrl,
      authSettings: structuredClone(project.authSettings),
      authReturnUrls: project.authReturnUrls ? { ...project.authReturnUrls } : undefined,
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

  #requireCustomerProject(
    project: ProjectDocument,
  ): CustomerProjectDocument {
    if (
      !project.identityDataMode ||
      !project.identifierString ||
      !project.authRealm ||
      !project.rpId ||
      !project.signupHostedUrl ||
      !project.signinHostedUrl ||
      !project.authSettings
    ) {
      throw new ProjectError("project_configuration_invalid", 500);
    }
    return project as CustomerProjectDocument;
  }
}

export function canonicalizeHostedAuthReturnUrls(
  input: HostedAuthReturnUrls,
  environment: HostedAuthDeploymentEnvironment,
): HostedAuthReturnUrls {
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => [
      name,
      canonicalizeHostedAuthReturnUrl(value, environment),
    ]),
  ) as HostedAuthReturnUrls;
}

function canonicalizeHostedAuthReturnUrl(
  value: string,
  environment: HostedAuthDeploymentEnvironment,
): string {
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ProjectError("invalid_auth_return_url", 400);
  }
  const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/iu.exec(value)?.[1];
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProjectError("invalid_auth_return_url", 400);
  }
  const developmentHttp =
    environment === "development" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname.endsWith(".localhost"));
  if (
    !authority ||
    (url.protocol !== "https:" && !developmentHttp) ||
    url.username ||
    url.password ||
    url.hash ||
    url.hostname.includes("*") ||
    authority.includes("%") ||
    authority.includes("@") ||
    (environment !== "development" && url.port) ||
    authority.toLowerCase() !== url.host
  ) {
    throw new ProjectError("invalid_auth_return_url", 400);
  }
  return url.toString();
}

function createHostedAuthProjectConfiguration(
  environment: HostedAuthDeploymentEnvironment,
  identityDataMode: HostedAuthIdentityDataMode,
  projectSlug: string,
) {
  const identifierString = ProjectIdentifierStringSchema.parse(
    `pai_${createSecret()}`,
  );
  const realm = HOSTED_AUTH_DEPLOYMENTS[environment][identityDataMode];
  return {
    identityDataMode,
    identifierString,
    authRealm: realm.origin,
    rpId: realm.rpId,
    signupHostedUrl: hostedAuthEntryUrl(
      realm.origin,
      "signup",
      projectSlug,
      identifierString,
    ),
    signinHostedUrl: hostedAuthEntryUrl(
      realm.origin,
      "signin",
      projectSlug,
      identifierString,
    ),
  };
}

function hostedAuthEntryUrl(
  origin: string,
  flow: "signup" | "signin",
  projectSlug: string,
  identifierString: string,
): string {
  return new URL(
    `/${flow}/${encodeURIComponent(projectSlug)}/${encodeURIComponent(identifierString)}`,
    origin,
  ).toString();
}
