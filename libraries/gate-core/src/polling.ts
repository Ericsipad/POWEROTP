export type AuthoritativeVerificationStatus = "pending" | "verified" | "unavailable";

type PollTimer = number | ReturnType<typeof setTimeout>;

export interface AuthoritativePollerOptions {
  intervalMs: number;
  check(): Promise<AuthoritativeVerificationStatus>;
  onStatus(status: AuthoritativeVerificationStatus): void;
  setTimer?: (callback: () => void, delayMs: number) => PollTimer;
  clearTimer?: (timer: PollTimer) => void;
}

export interface AuthoritativePoller {
  start(): void;
  triggerNow(): void;
  stop(): void;
  isRunning(): boolean;
}

/**
 * Polling is the authority boundary. Iframe messages may call `triggerNow`,
 * but only `check()` can return the server-confirmed `verified` status.
 */
export function createAuthoritativePoller(
  options: AuthoritativePollerOptions,
): AuthoritativePoller {
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 1) {
    throw new Error("Authoritative polling interval must be a positive integer");
  }

  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let running = false;
  let checking = false;
  let triggerAfterCheck = false;
  let timer: PollTimer | undefined;
  let generation = 0;

  const clearScheduled = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  const schedule = (delayMs: number) => {
    if (!running) return;
    clearScheduled();
    timer = setTimer(runCheck, delayMs);
  };

  const runCheck = () => {
    timer = undefined;
    if (!running) return;
    if (checking) {
      triggerAfterCheck = true;
      return;
    }

    checking = true;
    const checkGeneration = generation;
    void options.check().then(
      (status) => {
        if (!running || generation !== checkGeneration) return;
        options.onStatus(status);
        if (status === "verified") {
          running = false;
          clearScheduled();
          return;
        }
        schedule(triggerAfterCheck ? 0 : options.intervalMs);
      },
      () => {
        if (!running || generation !== checkGeneration) return;
        options.onStatus("unavailable");
        schedule(triggerAfterCheck ? 0 : options.intervalMs);
      },
    ).finally(() => {
      if (generation !== checkGeneration) return;
      checking = false;
      triggerAfterCheck = false;
    });
  };

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      schedule(0);
    },
    triggerNow() {
      if (!running) return;
      if (checking) {
        triggerAfterCheck = true;
        return;
      }
      schedule(0);
    },
    stop() {
      running = false;
      generation += 1;
      checking = false;
      triggerAfterCheck = false;
      clearScheduled();
    },
    isRunning: () => running,
  };
}
