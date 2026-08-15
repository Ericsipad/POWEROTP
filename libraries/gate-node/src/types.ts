import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  BehaviorReport,
  BotBlockerUnavailableResponse,
  DecisionRevisionEnvelope,
  GateRecommendationSnapshot,
  InitialBrowserProofEvidence,
  OtpLaunchMetadata,
  ReportSequence,
  RequestContext,
  SignedSiteClearance,
} from "@powerotp/contracts";
import type {
  BotBlockerVerificationKeySet,
} from "@powerotp/botblocker-signing";
import type {
  AuthoritativeGateStatus,
  DecisionVerification,
  RestoredGateSecurityState,
} from "@powerotp/gate-core";

export interface GateSession {
  id: string;
  nextSequence: number;
  requestContext?: RequestContext;
  lastApplied?: ReportSequence;
  acceptedNonces: string[];
  activeChallenge?: ChallengeMetadata;
  challengeOpened?: boolean;
  latestDecisionOutcome?: "allow" | "otp";
  challengeVerified?: boolean;
  pendingDecision?: Promise<DecisionServiceResult>;
  initialBrowser?: InitialBrowserProofEvidence;
  visitorToken?: string;
  recommendation?: GateRecommendationSnapshot;
  clearanceVerified?: boolean;
  latestDecision?: unknown;
  latestClearance?: unknown;
}

export type ChallengeMetadata = OtpLaunchMetadata;

export interface GateSessionStore {
  get(id: string): Promise<GateSession | undefined> | GateSession | undefined;
  set(session: GateSession): Promise<void> | void;
}

export interface DecisionResult {
  status: "decision";
  candidate: unknown;
  clearance?: unknown;
  challenge?: ChallengeMetadata;
}

export type DecisionServiceResult =
  | DecisionResult
  | BotBlockerUnavailableResponse;

export interface InitialDecisionResult extends DecisionResult {
  visitorToken: string;
}

export type InitialDecisionServiceResult =
  | InitialDecisionResult
  | BotBlockerUnavailableResponse;

export interface InitialDecisionRequest {
  siteCredential: string;
  context: RequestContext;
  browser: InitialBrowserProofEvidence;
}

export interface ScopedVisitorAuthorization {
  visitorToken: string;
}

export interface GateNodeServices {
  requestDecision(
    request: InitialDecisionRequest,
    session: Readonly<GateSession>,
  ): Promise<InitialDecisionServiceResult>;
  verifyDecision(
    candidate: unknown,
    session: Readonly<GateSession>,
  ): Promise<DecisionVerification>;
  assessBrowser(
    report: BehaviorReport,
    authorization: ScopedVisitorAuthorization,
    session: Readonly<GateSession>,
  ): Promise<DecisionServiceResult>;
  launchChallenge(
    authorization: ScopedVisitorAuthorization,
    session: Readonly<GateSession>,
  ): Promise<ChallengeMetadata | BotBlockerUnavailableResponse>;
  pollChallenge(
    challenge: ChallengeMetadata,
    authorization: ScopedVisitorAuthorization,
    session: Readonly<GateSession>,
  ): Promise<AuthoritativeGateStatus | BotBlockerUnavailableResponse>;
}

export interface TrustedProxyConfig {
  header: "x-forwarded-for" | "x-real-ip";
  trustedRemoteAddresses: readonly string[];
  select: "first" | "last";
  expectedProxyCount?: number;
}

export interface GateNodeLimits {
  maxPathBytes?: number;
  maxHeaderBytes?: number;
  maxHeaderCount?: number;
  maxBodyBytes?: number;
}

export type GateNodeEvent =
  | { type: "decision_unavailable"; reason: BotBlockerUnavailableResponse["reason"] }
  | { type: "decision_rejected" }
  | { type: "invalid_request"; route: "bridge" | "application" }
  | { type: "request_error"; route: "bridge" | "application" };

export type ProtectedRequestState =
  | {
      protected: false;
      access: "excluded";
    }
  | {
      protected: true;
      access: "checking" | "clearance" | "fail_open" | "allow" | "otp" | "unavailable";
      sessionId?: string;
      recommendation: GateRecommendationSnapshot;
    };

export type ProtectedRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  state: ProtectedRequestState,
) => void | Promise<void>;

export interface GateNodeOptions {
  siteId: string;
  siteCredential: string;
  audience: string;
  verificationKeys: BotBlockerVerificationKeySet;
  protect(context: RequestContext): boolean;
  handle: ProtectedRouteHandler;
  services?: Partial<GateNodeServices>;
  decisionTimeoutMs?: number;
  trustedProxy?: TrustedProxyConfig;
  limits?: GateNodeLimits;
  sessionStore?: GateSessionStore;
  cookieName?: string;
  sessionCookieName?: string;
  cookieSecure?: boolean;
  cleanDataPage?: {
    url: string;
    metadataUrl?: string;
  };
  onEvent?: (event: GateNodeEvent) => void;
  now?: () => number;
}

export interface BrowserBootstrap {
  protocolVersion: 1;
  siteId: string;
  audience: string;
  gateSessionId: string;
  startingSequence: number;
  decisionTimeoutMs: number;
  restoredSecurityState?: RestoredGateSecurityState;
}

export interface ClearanceVerification {
  valid: boolean;
  clearance?: SignedSiteClearance;
}
