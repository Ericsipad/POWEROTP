import {
  BOTBLOCKER_PROTOCOL_VERSION,
  BotBlockerUnavailableResponseSchema,
  type BotBlockerUnavailableResponse,
  type DecisionRevisionEnvelope,
  type RequestContext,
} from "@powerotp/contracts";
import { validateVerifiedDecision } from "@powerotp/gate-core";

import type {
  DecisionResult,
  DecisionServiceResult,
  GateNodeServices,
  GateSession,
} from "./types.js";

export const UNAVAILABLE: BotBlockerUnavailableResponse =
  BotBlockerUnavailableResponseSchema.parse({
    status: "unavailable",
    reason: "not_implemented",
    message: "This service is not available",
    retryable: false,
  });

export function createServices(
  supplied: Partial<GateNodeServices> | undefined,
): GateNodeServices {
  return {
    requestDecision: supplied?.requestDecision ?? (async () => UNAVAILABLE),
    verifyDecision:
      supplied?.verifyDecision ?? (async () => ({ verified: false, reason: "unavailable" })),
    assessBrowser: supplied?.assessBrowser ?? (async () => UNAVAILABLE),
    pollChallenge: supplied?.pollChallenge ?? (async () => UNAVAILABLE),
  };
}

export function beginDecision(options: {
  context: RequestContext;
  session: GateSession;
  services: GateNodeServices;
  save(): Promise<void>;
}): Promise<DecisionServiceResult> {
  if (options.session.pendingDecision) return options.session.pendingDecision;
  const pending = Promise.resolve()
    .then(() => options.services.requestDecision(options.context, options.session))
    .then((result) => {
      if (result.status === "decision") {
        const challenge = result.challenge ? normalizeChallenge(result.challenge) : undefined;
        options.session.latestDecision = result.candidate;
        options.session.latestClearance = result.clearance;
        if (challenge) {
          options.session.activeChallenge = challenge;
          options.session.challengeVerified = false;
          options.session.challengeOpened = false;
        }
      }
      return options.save().then(() => result);
    })
    .catch(() => UNAVAILABLE)
    .finally(() => {
      options.session.pendingDecision = undefined;
      void options.save();
    });
  options.session.pendingDecision = pending;
  void options.save();
  return pending;
}

export async function verifyDecisionForSession(options: {
  candidate: unknown;
  session: GateSession;
  services: GateNodeServices;
  siteId: string;
  audience: string;
  now: number;
}): Promise<DecisionRevisionEnvelope | undefined> {
  const verification = await options.services.verifyDecision(
    options.candidate,
    options.session,
  );
  const validated = validateVerifiedDecision(verification, {
    siteId: options.siteId,
    gateSessionId: options.session.id,
    audience: options.audience,
    now: options.now,
    lastApplied: options.session.lastApplied,
    acceptedNonces: new Set(options.session.acceptedNonces),
  });
  return validated.accepted ? validated.decision : undefined;
}

export function safeDecisionResult(result: DecisionServiceResult): object {
  if (result.status === "unavailable") return result;
  return {
    status: "decision",
    candidate: result.candidate,
  };
}

export function bootstrapProtocolVersion(): 1 {
  return BOTBLOCKER_PROTOCOL_VERSION;
}

export function normalizeChallenge(
  challenge: NonNullable<DecisionResult["challenge"]>,
) {
  if (challenge.challengeId.length < 16 || challenge.challengeId.length > 200) {
    throw new TypeError("Challenge metadata is invalid");
  }
  const url = new URL(challenge.challengeUrl);
  const origin = new URL(challenge.challengeOrigin);
  if (
    url.protocol !== "https:" ||
    origin.protocol !== "https:" ||
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    origin.username ||
    origin.password
  ) {
    throw new TypeError("Challenge metadata must use its approved HTTPS origin");
  }
  return {
    challengeId: challenge.challengeId,
    challengeUrl: url.toString(),
    challengeOrigin: origin.origin,
  };
}
