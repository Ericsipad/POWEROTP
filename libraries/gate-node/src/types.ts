import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  BotBlockerDataReadyCallbackEvent,
  BotBlockerOfflineResponse,
  BotBlockerSessionDataResponse,
  BotBlockerUnavailableResponse,
  CanonicalReportRequest,
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
  offlineUntil?: number;
  recommendation?: GateRecommendationSnapshot;
  clearanceVerified?: boolean;
  latestDecision?: unknown;
  latestClearance?: unknown;
  authoritativeSessionData?: BotBlockerSessionDataResponse;
  acceptedCallbackEventIds?: string[];
  acceptedCallbackNonces?: string[];
}

export type ChallengeMetadata = OtpLaunchMetadata;

export interface GateSessionStore {
  get(id: string): Promise<GateSession | undefined> | GateSession | undefined;
  set(session: GateSession): Promise<void> | void;
  applyDataReady(
    event: BotBlockerDataReadyCallbackEvent,
    data: BotBlockerSessionDataResponse,
  ):
    | Promise<"applied" | "duplicate_event" | "replayed_nonce" | "session_not_found">
    | "applied"
    | "duplicate_event"
    | "replayed_nonce"
    | "session_not_found";
}

export interface DecisionResult {
  status: "decision";
  candidate: unknown;
  clearance?: unknown;
  challenge?: ChallengeMetadata;
}

export type DecisionServiceResult =
  | DecisionResult
  | BotBlockerUnavailableResponse
  | BotBlockerOfflineResponse;

export interface InitialDecisionResult extends DecisionResult {
  visitorToken: string;
}

export interface InitialSessionReadyResult {
  status: "ready";
  visitorToken: string;
  decision: BotBlockerUnavailableResponse;
}

export type InitialDecisionServiceResult =
  | InitialDecisionResult
  | InitialSessionReadyResult
  | BotBlockerUnavailableResponse
  | BotBlockerOfflineResponse;

export interface ScopedVisitorAuthorization {
  visitorToken: string;
}

export type ReportAuthorization =
  | { siteCredential: string }
  | ScopedVisitorAuthorization;

export interface GateNodeServices {
  submitReport(
    report: CanonicalReportRequest,
    authorization: ReportAuthorization,
    session: Readonly<GateSession>,
  ): Promise<InitialDecisionServiceResult | DecisionServiceResult>;
  verifyDecision(
    candidate: unknown,
    session: Readonly<GateSession>,
  ): Promise<DecisionVerification>;
  launchChallenge(
    authorization: ScopedVisitorAuthorization,
    session: Readonly<GateSession>,
  ): Promise<
    ChallengeMetadata | BotBlockerUnavailableResponse | BotBlockerOfflineResponse
  >;
  pollChallenge(
    challenge: ChallengeMetadata,
    authorization: ScopedVisitorAuthorization,
    session: Readonly<GateSession>,
  ): Promise<
    AuthoritativeGateStatus | BotBlockerUnavailableResponse | BotBlockerOfflineResponse
  >;
  pullSessionData(
    event: BotBlockerDataReadyCallbackEvent,
    authorization: ScopedVisitorAuthorization,
    session: Readonly<GateSession>,
  ): Promise<BotBlockerSessionDataResponse | BotBlockerUnavailableResponse>;
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

export type AdvisoryRequestState =
  | {
      advisory: false;
      status: "excluded";
    }
  | {
      advisory: true;
      status: "checking" | "clearance" | "fail_open" | "offline" | "allow" | "otp" | "unavailable";
      sessionId?: string;
      recommendation: GateRecommendationSnapshot;
    };

export type AdvisoryRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  state: AdvisoryRequestState,
) => void | Promise<void>;

export interface GateNodeOptions {
  projectId?: string;
  siteId: string;
  webhookId: string;
  siteCredential: string;
  callbackSigningSecret?: string;
  audience: string;
  verificationKeys: BotBlockerVerificationKeySet;
  handle: AdvisoryRouteHandler;
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
