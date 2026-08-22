import { z } from "zod";

import { HostedAuthRealmSchema } from "./hosted-auth-boundaries.js";
import {
  HostedAuthRequestIdSchema,
  ProjectIdentifierStringSchema,
} from "./hosted-auth-identifiers.js";
import {
  HostedAuthFlowSchema,
  HostedAuthMachineScopeSchema,
} from "./hosted-auth-state-machine-core.js";
import {
  HostedAuthApiVersionSchema,
  HostedAuthBrowserProtocolVersionSchema,
} from "./hosted-auth-protocol.js";

export const HostedAuthLaunchSurfaceSchema = z.enum([
  "browser_tab",
  "standalone_pwa",
  "mobile_handoff",
]);

export const HostedAuthBrowserRequestHandleSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, "Use an opaque unpadded base64url handle")
  .brand<"HostedAuthBrowserRequestHandle">();

/**
 * Complete navigation authority for a hosted ceremony. It remains usable when
 * there is no opener, referrer, shared history entry, or ordinary browser tab.
 */
export const HostedAuthBrowserNavigationContextSchema = z
  .object({
    browserProtocolVersion: HostedAuthBrowserProtocolVersionSchema,
    authRequestId: HostedAuthRequestIdSchema,
    scope: HostedAuthMachineScopeSchema,
    requestHandle: HostedAuthBrowserRequestHandleSchema,
    launchSurface: HostedAuthLaunchSurfaceSchema,
    navigationAuthority: z.literal("server_resolved_request_context"),
    completionMechanism: z.literal("server_configured_redirect"),
  })
  .strict();

export const HostedAuthReturnHintSchema = z.enum([
  "pending",
  "succeeded",
  "failed",
  "signup_required",
  "canceled",
  "recovered",
]);

export const HostedAuthBrowserReturnQuerySchema = z
  .object({
    authRequestId: HostedAuthRequestIdSchema,
    hint: HostedAuthReturnHintSchema,
  })
  .strict();

export const HostedAuthRouteAudienceSchema = z.enum([
  "project_backend",
  "hosted_browser",
  "provider_webhook",
]);
export const HostedAuthRouteAuthSchema = z.enum([
  "project_api_key_and_idempotency_key",
  "project_api_key_and_poll_token",
  "realm_cookie_and_browser_handle",
  "realm_cookie_browser_handle_and_csrf",
  "signed_provider_callback",
]);
export const HostedAuthRouteCachePolicySchema = z.literal("no_store");

const RouteContractSchema = z
  .object({
    apiVersion: HostedAuthApiVersionSchema,
    name: z.string().min(1).max(100),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    pathTemplate: z.string().startsWith("/v1/").max(300),
    audience: HostedAuthRouteAudienceSchema,
    authentication: HostedAuthRouteAuthSchema,
    cachePolicy: HostedAuthRouteCachePolicySchema,
    requiresIdempotencyKey: z.boolean(),
  })
  .strict()
  .superRefine((route, context) => {
    const projectWrite =
      route.authentication === "project_api_key_and_idempotency_key";
    if (route.requiresIdempotencyKey !== projectWrite) {
      context.addIssue({
        code: "custom",
        message: "Project create/replace/send routes require idempotency",
        path: ["requiresIdempotencyKey"],
      });
    }
    if (
      route.audience === "hosted_browser" &&
      route.authentication !== "realm_cookie_and_browser_handle" &&
      route.authentication !== "realm_cookie_browser_handle_and_csrf"
    ) {
      context.addIssue({
        code: "custom",
        message: "Hosted browser routes use only realm browser authority",
        path: ["authentication"],
      });
    }
    if (
      route.audience === "hosted_browser" &&
      (route.method === "GET") !==
        (route.authentication === "realm_cookie_and_browser_handle")
    ) {
      context.addIssue({
        code: "custom",
        message: "Only hosted mutations require same-origin CSRF authority",
        path: ["authentication"],
      });
    }
  });

const apiVersion = "2026-08-21" as const;
const projectBase = "/v1/projects/{projectSlug}/auth-requests";
const hostedBase = "/v1/hosted/auth-requests/{authRequestId}";

export const hostedAuthRouteContracts = [
  {
    apiVersion,
    name: "create_auth_request",
    method: "POST",
    pathTemplate: projectBase,
    audience: "project_backend",
    authentication: "project_api_key_and_idempotency_key",
    cachePolicy: "no_store",
    requiresIdempotencyKey: true,
  },
  {
    apiVersion,
    name: "poll_auth_request",
    method: "GET",
    pathTemplate: `${projectBase}/{authRequestId}`,
    audience: "project_backend",
    authentication: "project_api_key_and_poll_token",
    cachePolicy: "no_store",
    requiresIdempotencyKey: false,
  },
  {
    apiVersion,
    name: "cancel_auth_request",
    method: "POST",
    pathTemplate: `${projectBase}/{authRequestId}/cancel`,
    audience: "project_backend",
    authentication: "project_api_key_and_poll_token",
    cachePolicy: "no_store",
    requiresIdempotencyKey: false,
  },
  ...[
    ["read_request", "GET", ""],
    ["cancel_request", "POST", "/cancel"],
    ["registration_options", "POST", "/webauthn/registration/options"],
    ["registration_verify", "POST", "/webauthn/registration/verify"],
    ["authentication_options", "POST", "/webauthn/authentication/options"],
    ["authentication_verify", "POST", "/webauthn/authentication/verify"],
    ["contact_send", "POST", "/contact/send"],
    ["contact_verify", "POST", "/contact/verify"],
    ["recovery_state", "GET", "/recovery"],
    ["recovery_continue", "POST", "/recovery/continue"],
    ["credential_manage", "POST", "/credentials"],
    ["provider_start", "POST", "/verification/start"],
    ["provider_return", "GET", "/verification/return"],
    ["provider_status", "GET", "/verification/status"],
  ].map(([name, method, suffix]) => ({
    apiVersion,
    name: `hosted_${name}`,
    method,
    pathTemplate: `${hostedBase}${suffix}`,
    audience: "hosted_browser",
    authentication:
      method === "GET"
        ? "realm_cookie_and_browser_handle"
        : "realm_cookie_browser_handle_and_csrf",
    cachePolicy: "no_store",
    requiresIdempotencyKey: false,
  })),
  {
    apiVersion,
    name: "provider_webhook",
    method: "POST",
    pathTemplate: "/v1/private/hosted-auth/providers/{provider}/webhook",
    audience: "provider_webhook",
    authentication: "signed_provider_callback",
    cachePolicy: "no_store",
    requiresIdempotencyKey: false,
  },
] as const;

export const HostedAuthRouteManifestSchema = z
  .object({
    apiVersion: HostedAuthApiVersionSchema,
    supportedLaunchSurfaces: z.tuple([
      z.literal("browser_tab"),
      z.literal("standalone_pwa"),
      z.literal("mobile_handoff"),
    ]),
    forbiddenNavigationAuthorities: z.tuple([
      z.literal("window_opener"),
      z.literal("browser_history"),
      z.literal("document_referrer"),
    ]),
    routes: z.array(RouteContractSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const names = manifest.routes.map((route) => route.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        message: "Route names must be unique",
        path: ["routes"],
      });
    }
  });

export const hostedAuthRouteManifest = HostedAuthRouteManifestSchema.parse({
  apiVersion,
  supportedLaunchSurfaces: [
    "browser_tab",
    "standalone_pwa",
    "mobile_handoff",
  ],
  forbiddenNavigationAuthorities: [
    "window_opener",
    "browser_history",
    "document_referrer",
  ],
  routes: hostedAuthRouteContracts,
});

export const HostedAuthHostedEntrySchema = z
  .object({
    realm: HostedAuthRealmSchema,
    flow: HostedAuthFlowSchema,
    projectSlug: z.string().min(1).max(100),
    identifierString: ProjectIdentifierStringSchema,
  })
  .strict();

export type HostedAuthLaunchSurface = z.infer<
  typeof HostedAuthLaunchSurfaceSchema
>;
export type HostedAuthBrowserNavigationContext = z.infer<
  typeof HostedAuthBrowserNavigationContextSchema
>;
