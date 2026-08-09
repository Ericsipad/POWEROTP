"use client";

import type { VerificationStatus, VerificationType } from "@powerotp/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { VerificationModalView, type ResponseBody } from "@/app/verification-modal/verification-modal-view";

const hintNumbers = [
  "+1 555 123 4567",
  "+44 7911 123456",
  "+971 54 555 1234",
  "+66 81 555 1234",
  "+91 98765 43210",
  "+52 55 1234 5678",
  "+27 71 234 5678",
  "+81 90 1234 5678",
  "+33 6 12 34 56 78",
  "+55 11 91234 5678",
];

const demoMethods: Array<{ id: VerificationType; label: string; description: string }> = [
  {
    id: "call_reachability",
    label: "Call reachability",
    description: "Confirms the number answers a live call.",
  },
  {
    id: "voice_code",
    label: "Voice code",
    description: "Loops a spoken 5-digit code over a call.",
  },
  {
    id: "voice_challenge",
    label: "Voice challenge",
    description: "Plays a recording and returns a question.",
  },
  {
    id: "sms_code",
    label: "SMS code",
    description: "Sends a 5-digit verification code by text.",
  },
];

const TERMINAL_STATES = new Set(["succeeded", "failed", "expired", "canceled"]);
const MAX_POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 1_200;

interface TimelineEntry {
  id: string;
  label: string;
  payload: unknown;
}

function formatEntry(entry: TimelineEntry) {
  return `// ${entry.label}\n${JSON.stringify(entry.payload, null, 2)}`;
}

function sanitizeNumber(rawValue: string) {
  const digits = rawValue.replace(/[^\d]/g, "");
  return `+${digits}`;
}

export function TryItNow() {
  const [hintIndex, setHintIndex] = useState(0);
  const [targetNumber, setTargetNumber] = useState("+");
  const [type, setType] = useState<VerificationType>("call_reachability");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [liveInteractionId, setLiveInteractionId] = useState<string>();
  const pollGeneration = useRef(0);

  useEffect(() => {
    const interval = setInterval(
      () => setHintIndex((current) => (current + 1) % hintNumbers.length),
      1_500,
    );
    return () => clearInterval(interval);
  }, []);

  function pushEntry(label: string, payload: unknown) {
    setTimeline((current) => [...current, { id: `${Date.now()}-${label}`, label, payload }].slice(-6));
  }

  async function poll(interactionId: string, generation: number, attempt: number) {
    if (generation !== pollGeneration.current) return;
    if (attempt > MAX_POLL_ATTEMPTS) {
      setRunning(false);
      return;
    }

    const response = await fetch(`/v1/demo/verifications/${interactionId}`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (generation !== pollGeneration.current) return;
    pushEntry(`Webhook · status ${response.status}`, data);

    if (response.ok && !TERMINAL_STATES.has(data.state)) {
      setTimeout(() => void poll(interactionId, generation, attempt + 1), POLL_INTERVAL_MS);
    } else {
      setRunning(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setTimeline([]);
    setRunning(true);
    setLiveInteractionId(undefined);
    const generation = pollGeneration.current + 1;
    pollGeneration.current = generation;

    const requestBody = { type, targetNumber };
    pushEntry("POST /v1/demo/verifications", requestBody);

    try {
      const response = await fetch("/v1/demo/verifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      pushEntry(`Response ${response.status}`, data);

      if (!response.ok) {
        setError(
          response.status === 404
            ? "The live demo project is not configured yet."
            : "The demo request was rejected.",
        );
        setRunning(false);
        return;
      }

      setLiveInteractionId(data.interactionId);
      void poll(data.interactionId, generation, 0);
    } catch {
      setError("The demo request could not reach the API.");
      setRunning(false);
    }
  }

  async function fetchDemoStatus(interactionId: string): Promise<VerificationStatus | null> {
    const response = await fetch(`/v1/demo/verifications/${interactionId}`, {
      cache: "no-store",
    }).catch(() => undefined);
    if (!response?.ok) return null;
    return (await response.json()) as VerificationStatus;
  }

  async function submitDemoResponse(
    interactionId: string,
    body: ResponseBody,
  ): Promise<{ succeeded: boolean } | null> {
    const response = await fetch(`/v1/demo/verifications/${interactionId}/response`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);
    if (!response?.ok) return null;
    return (await response.json()) as { succeeded: boolean };
  }

  /** "Try a phone call instead" on the demo's sms_code preview — starts a
   * brand-new voice_code attempt for the same number, as its own separate
   * operation, replacing the previewed interaction entirely. */
  async function retryDemoAsVoiceCall() {
    const response = await fetch("/v1/demo/verifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "voice_code" as VerificationType, targetNumber }),
    }).catch(() => undefined);
    if (!response?.ok) return;
    const data = await response.json();
    setLiveInteractionId(data.interactionId);
  }

  function closeModalPreview() {
    setLiveInteractionId(undefined);
  }

  return (
    <div className="tryItNowRow">
      <div className="tryItNow">
        <span className="sectionLabel">Try it now</span>
        <p className="tryItNowCopy">
          Send a real request to the live POWEROTP API and watch the exact lifecycle events
          underneath.
        </p>
        <form className="tryItNowForm" onSubmit={submit}>
          <label className="field">
            Phone number
            <input
              value={targetNumber}
              onChange={(event) => setTargetNumber(sanitizeNumber(event.target.value))}
              inputMode="tel"
              required
              minLength={8}
            />
          </label>
          <p className="tryItNowHint">e.g. {hintNumbers[hintIndex]}</p>
          <p className="tryItNowHint">
            Always include your country code — e.g. <strong>+1</strong> for the US/Canada.
            Omitting it silently sends a different, invalid number to a different country.
          </p>

          <div className="tryItNowTypes">
            {demoMethods.map((method) => (
              <label
                key={method.id}
                className={type === method.id ? "tryItNowType tryItNowTypeActive" : "tryItNowType"}
              >
                <input
                  type="radio"
                  name="demoType"
                  value={method.id}
                  checked={type === method.id}
                  onChange={() => setType(method.id)}
                />
                <span className="tryItNowTypeName">{method.label}</span>
                <span className="tryItNowTypeDescription">{method.description}</span>
              </label>
            ))}
          </div>

          <button className="button" type="submit" disabled={running}>
            {running ? "Running…" : "Send test verification"}
          </button>
          {error && <div className="formError">{error}</div>}
        </form>

        <div className="tryItNowCode codePanel">
          <div className="codeTop">
            <span>What&apos;s happening underneath</span>
            <span className="readOnly">LIVE API TRAFFIC</span>
          </div>
          <pre>
            <code>
              {timeline.length === 0
                ? "// Submit a number above to see real request/response JSON"
                : timeline.map(formatEntry).join("\n\n")}
            </code>
          </pre>
        </div>
      </div>

      {liveInteractionId && (
        <div className="tryItNowModalPreviewWrap">
          <p className="tryItNowBotNote">
            This OTP challenge is part of Bot Blocker and will only be shown to suspected bots.
          </p>
          <section className="widgetCard tryItNowModalPreview">
            <button
              className="widgetCardClose"
              type="button"
              onClick={closeModalPreview}
              aria-label="Close"
            >
              ×
            </button>
            <div className="widgetBrand">
              <span className="brandMark">P</span>
              POWEROTP
            </div>
            <span className="readOnly tryItNowModalBadge">THE MODAL YOUR CUSTOMERS SEE</span>
            <VerificationModalView
              key={liveInteractionId}
              interactionId={liveInteractionId}
              targetNumber={targetNumber}
              fetchStatus={() => fetchDemoStatus(liveInteractionId)}
              submitResponse={(body) => submitDemoResponse(liveInteractionId, body)}
              onRetryAsVoiceCall={retryDemoAsVoiceCall}
            />
          </section>
        </div>
      )}
    </div>
  );
}
