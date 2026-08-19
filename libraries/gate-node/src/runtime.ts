import {
  BOTBLOCKER_PROTOCOL_VERSION,
  BotBlockerOfflineResponseSchema,
  BotBlockerUnavailableResponseSchema,
  type BotBlockerUnavailableResponse,
  type DecisionRevisionEnvelope,
  type InitialBrowserProofEvidence,
  type RequestContext,
} from "@powerotp/contracts";
import { validateVerifiedDecision } from "@powerotp/gate-core";

import {
  checkingSnapshot,
  failOpenSnapshot,
  offlineSnapshot,
  retainsActiveOtp,
  unavailableSnapshot,
} from "./advisory.js";
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
    launchChallenge: supplied?.launchChallenge ?? (async () => UNAVAILABLE),
    pollChallenge: supplied?.pollChallenge ?? (async () => UNAVAILABLE),
    pullSessionData: supplied?.pullSessionData ?? (async () => UNAVAILABLE),
  };
}

export function beginDecision(options: {
  context: RequestContext;
  initialBrowser: InitialBrowserProofEvidence;
  siteCredential: string;
  decisionTimeoutMs: number;
  session: GateSession;
  services: GateNodeServices;
  save(): Promise<void>;
}): Promise<DecisionServiceResult> {
  if (options.session.pendingDecision) return options.session.pendingDecision;
  if (options.session.recommendation?.lifecycle !== "offline") {
    options.session.recommendation = checkingSnapshot(true, options.session.lastApplied);
  }
  const timeout = setTimeout(() => {
    if (
      options.session.pendingDecision &&
      !retainsActiveOtp(options.session) &&
      options.session.recommendation?.lifecycle === "checking"
    ) {
      options.session.recommendation = failOpenSnapshot(true, options.session.lastApplied);
      void options.save();
    }
  }, options.decisionTimeoutMs);
  const pending = Promise.resolve()
    .then(() =>
      options.services.requestDecision(
        {
          siteCredential: options.siteCredential,
          context: options.context,
          browser: options.initialBrowser,
        },
        options.session,
      ),
    )
    .then(async (result): Promise<DecisionServiceResult> => {
      if (result.status === "offline") {
        const parsed = BotBlockerOfflineResponseSchema.safeParse(result);
        if (!parsed.success) return UNAVAILABLE;
        if (!retainsActiveOtp(options.session)) {
          options.session.visitorToken = undefined;
          options.session.offlineUntil = Date.now() + parsed.data.retryAfterMs;
          options.session.recommendation = offlineSnapshot(options.session.lastApplied);
        }
        await options.save();
        return parsed.data;
      }
      if (result.status === "ready") {
        if (!isScopedVisitorToken(result.visitorToken)) return UNAVAILABLE;
        options.session.visitorToken = result.visitorToken;
        options.session.offlineUntil = undefined;
        if (!retainsActiveOtp(options.session)) {
          options.session.recommendation = unavailableSnapshot(options.session.lastApplied);
        }
        await options.save();
        return result.decision;
      }
      if (result.status === "decision") {
        if (!isScopedVisitorToken(result.visitorToken)) {
          if (!retainsActiveOtp(options.session)) {
            options.session.recommendation = unavailableSnapshot(options.session.lastApplied);
          }
          await options.save();
          return UNAVAILABLE;
        }
        const challenge = result.challenge ? normalizeChallenge(result.challenge) : undefined;
        options.session.visitorToken = result.visitorToken;
        options.session.offlineUntil = undefined;
        options.session.latestDecision = result.candidate;
        options.session.latestClearance = result.clearance;
        if (challenge) {
          options.session.activeChallenge = challenge;
          options.session.challengeVerified = false;
          options.session.challengeOpened = false;
        }
        options.session.recommendation = pendingFinished(options.session);
        await options.save();
        return {
          status: "decision" as const,
          candidate: result.candidate,
          ...(result.clearance !== undefined ? { clearance: result.clearance } : {}),
          ...(challenge ? { challenge } : {}),
        };
      }
      if (!retainsActiveOtp(options.session)) {
        options.session.recommendation = unavailableSnapshot(options.session.lastApplied);
      }
      await options.save();
      return result;
    })
    .catch(async () => {
      if (!retainsActiveOtp(options.session)) {
        if (options.session.recommendation?.lifecycle === "offline") {
          options.session.offlineUntil = Date.now() + 30_000;
        } else {
          options.session.recommendation = unavailableSnapshot(options.session.lastApplied);
        }
      }
      await options.save();
      return UNAVAILABLE;
    })
    .finally(() => {
      clearTimeout(timeout);
      options.session.pendingDecision = undefined;
      void options.save();
    });
  options.session.pendingDecision = pending;
  void options.save();
  return pending;
}

export function scopedVisitorAuthorization(session: GateSession) {
  return session.visitorToken
    ? { visitorToken: session.visitorToken }
    : undefined;
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
  if (result.status === "offline") {
    const parsed = BotBlockerOfflineResponseSchema.safeParse(result);
    return parsed.success ? parsed.data : UNAVAILABLE;
  }
  if (result.status === "unavailable") {
    const parsed = BotBlockerUnavailableResponseSchema.safeParse(result);
    return parsed.success ? parsed.data : UNAVAILABLE;
  }
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

function pendingFinished(session: GateSession) {
  return session.recommendation?.lifecycle === "fail_open"
    ? failOpenSnapshot(false, session.lastApplied)
    : checkingSnapshot(false, session.lastApplied);
}

function isScopedVisitorToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 4_096 &&
    /^[\x21-\x7e]+$/.test(value)
  );
}
