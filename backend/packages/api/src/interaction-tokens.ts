import type { InteractionTokenClaims, VerificationType } from "@powerotp/contracts";
import { InteractionTokenClaimsSchema } from "@powerotp/contracts";

import { createSecret, signPayload, verifySignedPayload } from "./security.js";

const DEFAULT_LIFETIME_MS = 5 * 60 * 1_000;

/**
 * Which interaction-token action (if any) a verification type's response
 * is submitted under. Shared by both the creation route (which issues the
 * token) and the response route (which verifies it), so the mapping is
 * never duplicated or allowed to drift between the two.
 */
const tokenActionByType: Partial<Record<VerificationType, InteractionTokenClaims["action"]>> = {
  voice_code: "submit_code",
  sms_code: "submit_code",
  email_code: "submit_code",
  voice_challenge: "submit_challenge",
};

export function tokenActionForType(type: VerificationType) {
  return tokenActionByType[type];
}

/**
 * Fixed `audience` used for `view_status` tokens minted for the hosted
 * verification modal (`frontend/app/widget/[sessionId]/page.tsx`) —
 * deliberately not the request's `Origin` header, unlike
 * `submit_code`/`submit_challenge` tokens (which must match a customer's
 * own allowlisted origin). A same-origin `GET` fetch is not guaranteed to
 * always include an `Origin` header across browsers, and the modal is
 * always served from this one control-plane origin we already own, so
 * there is nothing extra an origin check would defend against here that
 * the token's own signature/expiry/project/interaction-id scoping doesn't
 * already cover.
 */
export const WIDGET_STATUS_TOKEN_AUDIENCE = "powerotp-widget";

export class InteractionTokenError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode = 401,
  ) {
    super(code);
  }
}

export function issueInteractionToken(
  secret: string,
  claims: Omit<InteractionTokenClaims, "nonce" | "issuedAt" | "expiresAt">,
  lifetimeMs = DEFAULT_LIFETIME_MS,
) {
  const now = Date.now();
  const nonce = createSecret(16);
  const payload: InteractionTokenClaims = {
    ...claims,
    nonce,
    issuedAt: now,
    expiresAt: now + lifetimeMs,
  };
  return { token: signPayload(payload, secret), nonce };
}

/**
 * Verifies signature, expiry, and that the token was issued for this exact
 * project/interaction/action/origin. The caller is responsible for
 * single-use consumption (recorded on the verification document).
 */
export function verifyInteractionToken(
  token: string,
  secret: string,
  expected: {
    projectId: string;
    interactionId: string;
    action: InteractionTokenClaims["action"];
    audience: string;
  },
): InteractionTokenClaims {
  let claims: InteractionTokenClaims;
  try {
    claims = InteractionTokenClaimsSchema.parse(
      verifySignedPayload(token, secret),
    );
  } catch {
    throw new InteractionTokenError("invalid_interaction_token");
  }

  if (claims.expiresAt < Date.now()) {
    throw new InteractionTokenError("expired_interaction_token");
  }
  if (
    claims.projectId !== expected.projectId ||
    claims.interactionId !== expected.interactionId ||
    claims.action !== expected.action ||
    claims.audience !== expected.audience
  ) {
    throw new InteractionTokenError("invalid_interaction_token");
  }

  return claims;
}
