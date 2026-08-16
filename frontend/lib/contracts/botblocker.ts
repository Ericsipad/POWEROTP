export const BOTBLOCKER_TIMEOUT_MIN_MS = 50;
export const BOTBLOCKER_TIMEOUT_MAX_MS = 2_000;
export const BOTBLOCKER_TIMEOUT_DEFAULT_MS = 200;

export interface BotBlockerSiteConfiguration {
  siteId: string;
  projectId: string;
  enabled: boolean;
  decisionTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
}
