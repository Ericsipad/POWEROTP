import {
  AdminLoginSchema,
  CustomerLoginSchema,
  CustomerRegistrationSchema,
  VerifyEmailSchema,
} from "@powerotp/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AuthService } from "./auth-service.js";
import type { ProductionConfig } from "./config.js";
import { ApiError, parseBody } from "./errors.js";
import type { UserDocument } from "./persistence.js";

const SESSION_COOKIE = "powerotp_session";
const CSRF_COOKIE = "powerotp_csrf";

function sessionUser(user: UserDocument) {
  return {
    id: user._id,
    email: user.email,
    accountClass: user.accountClass,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

function header(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requireAllowedOrigin(request: FastifyRequest, publicAppUrl: string) {
  const origin = request.headers.origin;
  if (origin && origin !== new URL(publicAppUrl).origin) {
    throw new ApiError("origin_not_allowed", 403);
  }
}

function setSessionCookie(
  reply: FastifyReply,
  sessionToken: string,
  csrfToken: string,
  expiresAt: Date,
) {
  reply.setCookie(SESSION_COOKIE, sessionToken, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    expires: expiresAt,
  });
  reply.setCookie(CSRF_COOKIE, csrfToken, {
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "strict",
    expires: expiresAt,
  });
}

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  config: Pick<ProductionConfig, "PUBLIC_APP_URL">,
) {
  app.post(
    "/v1/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      requireAllowedOrigin(request, config.PUBLIC_APP_URL);
      await auth.register(parseBody(CustomerRegistrationSchema, request.body));
      return reply.code(202).send({ status: "verification_email_queued" });
    },
  );

  app.post(
    "/v1/auth/verify-email",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      requireAllowedOrigin(request, config.PUBLIC_APP_URL);
      const { token } = parseBody(VerifyEmailSchema, request.body);
      await auth.verifyEmail(token);
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      requireAllowedOrigin(request, config.PUBLIC_APP_URL);
      const session = await auth.loginCustomer(
        parseBody(CustomerLoginSchema, request.body),
      );
      setSessionCookie(
        reply,
        session.sessionToken,
        session.csrfToken,
        session.expiresAt,
      );
      return { user: sessionUser(session.user), csrfToken: session.csrfToken };
    },
  );

  app.post(
    "/v1/admin/login",
    { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      requireAllowedOrigin(request, config.PUBLIC_APP_URL);
      const session = await auth.loginAdmin(
        parseBody(AdminLoginSchema, request.body),
      );
      setSessionCookie(
        reply,
        session.sessionToken,
        session.csrfToken,
        session.expiresAt,
      );
      return { user: sessionUser(session.user), csrfToken: session.csrfToken };
    },
  );

  app.post(
    "/v1/admin/bootstrap",
    { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const result = await auth.bootstrapAdmin(
        parseBody(CustomerRegistrationSchema, request.body),
        header(request, "x-admin-bootstrap-token") ?? "",
      );
      return reply.code(201).send({
        user: sessionUser(result.user),
        totpUri: result.totpUri,
      });
    },
  );

  app.get("/v1/auth/session", async (request) => {
    const authenticated = await auth.authenticate(
      request.cookies[SESSION_COOKIE],
    );
    const csrfToken = request.cookies[CSRF_COOKIE];
    auth.verifyCsrf(authenticated.session, csrfToken);
    return {
      user: sessionUser(authenticated.user),
      csrfToken,
    };
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE];
    const authenticated = await auth.authenticate(sessionToken);
    auth.verifyCsrf(authenticated.session, header(request, "x-csrf-token"));
    await auth.logout(sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
    return reply.code(204).send();
  });
}
