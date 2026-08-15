import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  BehaviorReport,
  BotBlockerUnavailableResponse,
  DecisionRevisionEnvelope,
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
  challengeVerified?: boolean;
  pendingDecision?: Promise<DecisionServiceResult>;
  latestDecision?: unknown;
  latestClearance?: unknown;
}

export interface ChallengeMetadata {
  challengeId: string;
  challengeUrl: string;
  challengeOrigin: string;
}

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

export interface GateNodeServices {
  requestDecision(
    context: RequestContext,
    session: Readonly<GateSession>,
  ): Promise<DecisionServiceResult>;
  verifyDecision(
    candidate: unknown,
    session: Readonly<GateSession>,
  ): Promise<DecisionVerification>;
  assessBrowser(
    report: BehaviorReport,
    session: Readonly<GateSession>,
  ): Promise<DecisionServiceResult>;
  pollChallenge(
    challenge: ChallengeMetadata,
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

export interface ProtectedRequestState {
  protected: boolean;
  access: "excluded" | "clearance" | "optimistic" | "allow" | "otp" | "unavailable";
  sessionId?: string;
  decision?: DecisionRevisionEnvelope;
}

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
  challenge?: ChallengeMetadata;
}

export interface ClearanceVerification {
  valid: boolean;
  clearance?: SignedSiteClearance;
}
