export interface ChallengeUxMessage {
  source: "powerotp-botblocker";
  type: "challenge-status-changed";
  challengeId: string;
}

export interface ChallengeMessageGuardOptions {
  expectedOrigin: string;
  expectedSource: MessageEventSource | null;
  challengeId: string;
  requestAuthoritativePoll(): void;
}

function isChallengeUxMessage(value: unknown): value is ChallengeUxMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 3 &&
    record.source === "powerotp-botblocker" &&
    record.type === "challenge-status-changed" &&
    typeof record.challengeId === "string" &&
    record.challengeId.length >= 16
  );
}

/**
 * Accepts only a narrowly shaped UX notification. The resulting action is
 * an authoritative status poll, never a local verification transition.
 */
export function createChallengeMessageHandler(
  options: ChallengeMessageGuardOptions,
): (event: MessageEvent<unknown>) => boolean {
  const originUrl = new URL(options.expectedOrigin);
  if (originUrl.protocol !== "https:" || originUrl.username || originUrl.password) {
    throw new Error("BotBlocker message origin must be credential-free HTTPS");
  }
  const expectedOrigin = originUrl.origin;

  return (event) => {
    if (event.origin !== expectedOrigin || event.source !== options.expectedSource) return false;
    if (!isChallengeUxMessage(event.data)) return false;
    if (event.data.challengeId !== options.challengeId) return false;
    options.requestAuthoritativePoll();
    return true;
  };
}
