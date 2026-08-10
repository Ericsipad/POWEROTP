import { decryptEmail, type AuthService } from "@powerotp/api/auth-service.js";
import { ApiError } from "@powerotp/api/errors.js";
import type { UserDocument } from "@powerotp/api/persistence.js";
import { NextResponse, type NextRequest } from "next/server";

export const SESSION_COOKIE = "powerotp_session";
export const CSRF_COOKIE = "powerotp_csrf";

/** `piiEncryptionKey` is `config.PII_ENCRYPTION_KEY` — decrypts the
 * account's real email only transiently, for returning it to the
 * authenticated account itself in a session response. See
 * `apps/api/src/auth-service.ts#decryptEmail`. */
export function sessionUser(user: UserDocument, piiEncryptionKey: string) {
  return {
    id: user._id,
    email: decryptEmail(user, piiEncryptionKey),
    accountClass: user.accountClass,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

export function setSessionCookies(
  response: NextResponse,
  sessionToken: string,
  csrfToken: string,
  expiresAt: Date,
) {
  response.cookies.set(SESSION_COOKIE, sessionToken, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    expires: expiresAt,
  });
  response.cookies.set(CSRF_COOKIE, csrfToken, {
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "strict",
    expires: expiresAt,
  });
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(CSRF_COOKIE);
}

export async function requireCustomerSession(request: NextRequest, auth: AuthService) {
  const authenticated = await auth.authenticate(request.cookies.get(SESSION_COOKIE)?.value);
  if (authenticated.user.accountClass !== "customer") {
    throw new ApiError("customer_access_required", 403);
  }
  return authenticated;
}

export async function requireAdminSession(request: NextRequest, auth: AuthService) {
  const authenticated = await auth.authenticate(request.cookies.get(SESSION_COOKIE)?.value);
  if (authenticated.user.accountClass !== "platform_admin") {
    throw new ApiError("admin_access_required", 403);
  }
  return authenticated;
}

export function verifyCsrfHeader(
  request: NextRequest,
  auth: AuthService,
  session: Parameters<AuthService["verifyCsrf"]>[0],
) {
  auth.verifyCsrf(session, request.headers.get("x-csrf-token") ?? undefined);
}
