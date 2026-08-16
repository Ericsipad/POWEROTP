export type VerificationType =
  | "call_reachability"
  | "voice_code"
  | "voice_challenge"
  | "sms_code"
  | "email_code";

export type VerificationState =
  | "queued"
  | "dispatching"
  | "calling"
  | "ringing"
  | "answered"
  | "playing"
  | "awaiting_response"
  | "succeeded"
  | "failed"
  | "expired"
  | "canceled";

export interface VerificationStatus {
  interactionId: string;
  type: VerificationType;
  state: VerificationState;
  reasonCode?: string;
  createdAt: string;
  expiresAt: string;
  challenge?: {
    challengeId: string;
    question: string;
    options: Array<{ id: string; label: string }>;
    allowsMultiple: boolean;
    minSelections: number;
    maxSelections: number;
    expiresAt: string;
  };
}

export interface InteractionSummary {
  interactionId: string;
  occurredAt: string;
  type: VerificationType;
  state: VerificationState;
  maskedTarget: string;
  durationMs?: number;
  correlationId?: string;
}

export interface CallbackDeliverySummary {
  id: string;
  interactionId: string;
  eventId: string;
  projectId: string;
  attempt: number;
  status: "delivered" | "failed";
  statusCode?: number;
  error?: string;
  occurredAt: string;
}

export interface ModalSessionConfig {
  sessionId: string;
  projectName: string;
  allowedTypes: VerificationType[];
  attemptsRemaining: number;
  expiresAt: string;
}

export interface ModalSessionVerificationAccepted {
  interactionId: string;
  state: "queued";
  statusUrl: string;
  expiresAt: string;
  statusToken: string;
  interactionToken?: string;
}

export interface WidgetInteractionSummary {
  interactionId: string;
  occurredAt: string;
  type: VerificationType;
  state: string;
  maskedTarget: string;
  endUserIp?: string;
  endUserUserAgent?: string;
}
