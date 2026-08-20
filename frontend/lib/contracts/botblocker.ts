export const BOTBLOCKER_TIMEOUT_MIN_MS = 50;
export const BOTBLOCKER_TIMEOUT_MAX_MS = 2_000;
export const BOTBLOCKER_TIMEOUT_DEFAULT_MS = 200;

export type BotBlockerOtpMethod =
  | "call_reachability"
  | "voice_code"
  | "voice_challenge"
  | "sms_code"
  | "email_code";

export interface BotBlockerOtpMethodMarker {
  method: BotBlockerOtpMethod;
  enabled: boolean;
  triggerScore: number;
}

export interface BotBlockerSiteConfiguration {
  siteId: string;
  projectId: string;
  enabled: boolean;
  decisionTimeoutMs: number;
  otpMethodMarkers: BotBlockerOtpMethodMarker[];
  otpPolicyVersion: number;
  createdAt: string;
  updatedAt: string;
}
