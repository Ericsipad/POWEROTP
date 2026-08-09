"use client";

import type { VerificationStatus } from "@powerotp/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { VerifiedCelebration } from "./verified-celebration";

const TERMINAL_STATES = new Set(["succeeded", "failed", "expired", "canceled"]);
const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 1_500;

const progressCopy: Record<string, string> = {
  queued: "Preparing your verification…",
  dispatching: "Connecting…",
  calling: "Calling your number…",
  ringing: "Ringing…",
  answered: "Call answered…",
  playing: "Playing your verification…",
};

export type ResponseBody = { code: string } | { optionIds: string[] };

export interface VerificationModalViewProps {
  interactionId: string;
  targetNumber: string;
  /** Returns `null` on a transient error — polling continues rather than
   * surfacing a hard failure, since a single dropped request shouldn't
   * abandon an otherwise-healthy verification. */
  fetchStatus: () => Promise<VerificationStatus | null>;
  submitResponse: (body: ResponseBody) => Promise<{ succeeded: boolean } | null>;
  /** Fired once, the first time a terminal state is observed — callers use
   * this for their own side effects (e.g. the hosted modal's
   * `postMessage` to its parent window); this component's own celebration
   * animation always renders regardless. */
  onTerminal?(status: VerificationStatus): void;
}

/**
 * The shared "a verification is running" view: live progress, code/
 * challenge entry once `awaiting_response`, and the terminal
 * result — including the full `VerifiedCelebration` animation on success.
 * Deliberately agnostic of *how* status is fetched or a response is
 * submitted (auth differs: a real project's hosted modal uses interaction
 * tokens, the public marketing-site demo uses nothing at all) — see
 * `apps/web/app/widget/[sessionId]/widget-client.tsx` and
 * `apps/web/app/try-it-now.tsx` for the two callers.
 */
export function VerificationModalView({
  interactionId,
  targetNumber,
  fetchStatus,
  submitResponse,
  onTerminal,
}: VerificationModalViewProps) {
  const [status, setStatus] = useState<VerificationStatus>();
  const [codeInput, setCodeInput] = useState("");
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [responseError, setResponseError] = useState("");
  const pollGeneration = useRef(0);
  const notifiedTerminal = useRef(false);

  // Intentionally keyed only on `interactionId`: `fetchStatus` is expected
  // to be a stable-enough closure per interaction, and re-running this
  // effect on every parent re-render would restart polling from scratch.
  useEffect(() => {
    const generation = pollGeneration.current + 1;
    pollGeneration.current = generation;
    void poll(generation, 0);
    return () => {
      pollGeneration.current += 1;
    };
  }, [interactionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // `onTerminal` deliberately fires exactly once per interaction.
  useEffect(() => {
    if (!status || notifiedTerminal.current || !TERMINAL_STATES.has(status.state)) return;
    notifiedTerminal.current = true;
    onTerminal?.(status);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function poll(generation: number, attempt: number) {
    if (generation !== pollGeneration.current || attempt > MAX_POLL_ATTEMPTS) return;

    const data = await fetchStatus();
    if (generation !== pollGeneration.current) return;
    if (!data) {
      setTimeout(() => void poll(generation, attempt + 1), POLL_INTERVAL_MS);
      return;
    }

    setStatus(data);
    if (!TERMINAL_STATES.has(data.state)) {
      setTimeout(() => void poll(generation, attempt + 1), POLL_INTERVAL_MS);
    }
  }

  async function handleSubmitResponse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status) return;
    setResponseError("");

    const body: ResponseBody =
      status.type === "voice_challenge" ? { optionIds: selectedOptionIds } : { code: codeInput };
    const result = await submitResponse(body);
    if (!result) {
      setResponseError("That response could not be submitted. Please try again.");
      return;
    }
    void poll(pollGeneration.current, 0);
  }

  if (status && TERMINAL_STATES.has(status.state)) {
    return <VerifiedCelebration succeeded={status.state === "succeeded"} />;
  }

  if (status && status.state === "awaiting_response") {
    const challenge = status.type === "voice_challenge" ? status.challenge : undefined;
    return (
      <form className="widgetForm" onSubmit={handleSubmitResponse}>
        <p className="widgetCopy">Verifying {targetNumber}</p>
        {challenge ? (
          <fieldset className="field">
            <legend>{challenge.question}</legend>
            <div className="challengeOptions">
              {challenge.options.map((option) => (
                <label key={option.id} className="challengeOption">
                  <input
                    type={challenge.allowsMultiple ? "checkbox" : "radio"}
                    name="challengeOption"
                    value={option.id}
                    checked={selectedOptionIds.includes(option.id)}
                    onChange={(event) => {
                      if (challenge.allowsMultiple) {
                        setSelectedOptionIds((current) =>
                          event.target.checked
                            ? [...current, option.id]
                            : current.filter((id) => id !== option.id),
                        );
                      } else {
                        setSelectedOptionIds([option.id]);
                      }
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <label className="field">
            Enter the code you received
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              pattern="\d{5}"
              maxLength={5}
              required
              autoFocus
            />
          </label>
        )}
        {status.type === "sms_code" && (
          // Shown unconditionally today (no bot-detection exists yet). Per
          // the user's explicit note: once the future bot-blocker phase can
          // tell a detected bot from a suspected real human, this specific
          // hint should only render for the detected-bot case — a real
          // human getting an SMS delivery hiccup shouldn't be nudged toward
          // "prove you're human a second way" copy. Not gated on anything
          // now, since there's nothing to gate on yet.
          <p className="widgetNote">
            Didn&apos;t get a text? Try a phone call instead. Some carriers block
            international SMS.
          </p>
        )}
        <button className="button" type="submit">
          Submit
        </button>
        {responseError && <div className="formError">{responseError}</div>}
      </form>
    );
  }

  return (
    <div>
      <p className="widgetCopy">Verifying {targetNumber}</p>
      <p className="widgetProgress">
        {status ? progressCopy[status.state] ?? "Working on it…" : "Preparing your verification…"}
      </p>
    </div>
  );
}
