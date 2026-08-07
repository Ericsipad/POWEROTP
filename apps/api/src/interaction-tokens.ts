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
  voice_challenge: "submit_challenge",
};

export function tokenActionForType(type: VerificationType) {
  return tokenActionByType[type];
}

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
