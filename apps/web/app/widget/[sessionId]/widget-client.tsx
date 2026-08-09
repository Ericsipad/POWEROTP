"use client";

import type {
  ModalSessionConfig,
  ModalSessionVerificationAccepted,
  VerificationStatus,
  VerificationType,
} from "@powerotp/contracts";
import { useEffect, useState, type FormEvent } from "react";

import {
  VerificationModalView,
  type ResponseBody,
} from "@/app/verification-modal/verification-modal-view";

const methodLabels: Record<VerificationType, string> = {
  call_reachability: "Phone call",
  voice_code: "Phone call with a spoken code",
  voice_challenge: "Phone call with a spoken question",
  sms_code: "Text message code",
};

function sanitizeNumber(rawValue: string) {
  const digits = rawValue.replace(/[^\d]/g, "");
  return `+${digits}`;
}

interface WidgetClientProps {
  sessionId: string;
}

export function WidgetClient({ sessionId }: WidgetClientProps) {
  const [config, setConfig] = useState<ModalSessionConfig>();
  const [configError, setConfigError] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [type, setType] = useState<VerificationType>();
  const [targetNumber, setTargetNumber] = useState("+");
  const [passportKey, setPassportKey] = useState("");
  const [passportNotice, setPassportNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [accepted, setAccepted] = useState<ModalSessionVerificationAccepted>();

  useEffect(() => {
    void loadConfig();
  }, [sessionId]);

  async function loadConfig() {
    setConfigError("");
    try {
      const response = await fetch(`/v1/modal-sessions/${sessionId}`, { cache: "no-store" });
      if (!response.ok) {
        setConfigError(
          response.status === 404
            ? "This verification link has expired or is no longer valid."
            : "This verification could not be started right now.",
        );
        return;
      }
      const data = (await response.json()) as ModalSessionConfig;
      setConfig(data);
      setType(data.allowedTypes[0]);
    } catch {
      setConfigError("This verification could not reach POWEROTP.");
    } finally {
      setConfigLoaded(true);
    }
  }

  async function submitPhoneNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!type) return;
    setFormError("");
    setSubmitting(true);
    try {
      const response = await fetch(`/v1/modal-sessions/${sessionId}/verifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, targetNumber }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFormError(
          response.status === 429
            ? "Too many attempts for this verification. Please request a new link."
            : "That phone number could not be accepted.",
        );
        setSubmitting(false);
        return;
      }
      setAccepted(data as ModalSessionVerificationAccepted);
    } catch {
      setFormError("This verification could not reach POWEROTP.");
      setSubmitting(false);
    }
  }

  async function fetchStatus(current: ModalSessionVerificationAccepted): Promise<VerificationStatus | null> {
    const response = await fetch(`/v1/verifications/${current.interactionId}`, {
      cache: "no-store",
      headers: { "x-interaction-token": current.statusToken },
    }).catch(() => undefined);
    if (!response?.ok) return null;
    return (await response.json()) as VerificationStatus;
  }

  async function submitResponse(
    current: ModalSessionVerificationAccepted,
    body: ResponseBody,
  ): Promise<{ succeeded: boolean } | null> {
    const response = await fetch(`/v1/verifications/${current.interactionId}/response`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(current.interactionToken ? { "x-interaction-token": current.interactionToken } : {}),
      },
      body: JSON.stringify(body),
    }).catch(() => undefined);
    if (!response?.ok) return null;
    return (await response.json()) as { succeeded: boolean };
  }

  function handleTerminal(status: VerificationStatus) {
    window.parent.postMessage(
      {
        source: "powerotp-widget",
        sessionId,
        interactionId: status.interactionId,
        state: status.state,
        reasonCode: status.reasonCode,
      },
      "*",
    );
  }

  if (configError) {
    return (
      <section className="widgetCard">
        <WidgetBrand />
        <p className="formError">{configError}</p>
      </section>
    );
  }

  if (!configLoaded || !config || !type) {
    return (
      <section className="widgetCard">
        <WidgetBrand />
        <p className="widgetProgress">Loading…</p>
      </section>
    );
  }

  if (accepted) {
    return (
      <section className="widgetCard">
        <WidgetBrand />
        <VerificationModalView
          interactionId={accepted.interactionId}
          targetNumber={targetNumber}
          fetchStatus={() => fetchStatus(accepted)}
          submitResponse={(body) => submitResponse(accepted, body)}
          onTerminal={handleTerminal}
        />
      </section>
    );
  }

  return (
    <section className="widgetCard">
      <WidgetBrand />
      <p className="widgetCopy">Verify you&apos;re a real person to continue.</p>
      <form className="widgetForm" onSubmit={submitPhoneNumber}>
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

        {config.allowedTypes.length > 1 && (
          <div className="widgetMethods">
            {config.allowedTypes.map((option) => (
              <label
                key={option}
                className={type === option ? "widgetMethod widgetMethodActive" : "widgetMethod"}
              >
                <input
                  type="radio"
                  name="widgetMethod"
                  value={option}
                  checked={type === option}
                  onChange={() => setType(option)}
                />
                {methodLabels[option]}
              </label>
            ))}
          </div>
        )}

        <button className="button" type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Continue"}
        </button>
        {formError && <div className="formError">{formError}</div>}
      </form>

      <div className="passportSection">
        <p className="passportCopy">
          Are you an AI agent or automated crawler? Some sites let compliant agents pay to access
          protected data instead of completing human verification.{" "}
          <a href="https://powerotp.com" target="_blank" rel="noreferrer">
            Purchase an AI agent passport
          </a>{" "}
          (e.g. ClaudeBot, Hermes Agent) at powerotp.com. A passport grants access to{" "}
          <span>[protected website count]</span> participating sites.
        </p>
        <label className="field">
          Power Passport key
          <input
            value={passportKey}
            onChange={(event) => setPassportKey(event.target.value)}
            placeholder="Optional — for AI agents with a purchased passport"
            onFocus={() => setPassportNotice("")}
          />
        </label>
        <button
          className="button buttonSmall buttonGhost"
          type="button"
          onClick={() => setPassportNotice("Power Passport redemption is coming soon.")}
        >
          Redeem passport key
        </button>
        {passportNotice && <p className="widgetCopy">{passportNotice}</p>}
      </div>

      {/*
        Visually hidden from real visitors (off-screen, not display:none —
        some scrapers skip display:none) and hidden from assistive tech via
        aria-hidden/tabIndex, since it exists purely as a signal that
        whatever followed it is parsing raw HTML rather than looking at the
        rendered page. See docs/AS_BUILT.md's "Hosted verification modal"
        section.
      */}
      <a
        href={`/v1/modal-sessions/${sessionId}/ai-index-summary`}
        className="honeypotLink"
        aria-hidden="true"
        tabIndex={-1}
      >
        Website AI index summary
      </a>
    </section>
  );
}

function WidgetBrand() {
  return (
    <div className="widgetBrand">
      <span className="brandMark">P</span>
      POWEROTP
    </div>
  );
}
