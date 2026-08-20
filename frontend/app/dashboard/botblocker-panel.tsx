"use client";

import {
  BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  BOTBLOCKER_TIMEOUT_MAX_MS,
  BOTBLOCKER_TIMEOUT_MIN_MS,
  type BotBlockerOtpMethod,
  type BotBlockerOtpMethodMarker,
  type BotBlockerSiteConfiguration,
} from "@/lib/contracts";
import { useEffect, useState, type FormEvent } from "react";

interface BotBlockerPanelProps {
  projectId: string;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}

const methodLabels: Record<BotBlockerOtpMethod, string> = {
  call_reachability: "Call reachability",
  voice_code: "Voice code",
  voice_challenge: "Voice challenge",
  sms_code: "SMS code",
  email_code: "Email code",
};

export function BotBlockerPanel({
  projectId,
  authenticatedFetch,
}: BotBlockerPanelProps) {
  const [configuration, setConfiguration] =
    useState<BotBlockerSiteConfiguration>();
  const [markers, setMarkers] = useState<BotBlockerOtpMethodMarker[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void authenticatedFetch(`/v1/projects/${projectId}/botblocker`, {
      cache: "no-store",
    }).then(async (response) => {
      if (!active) return;
      if (!response.ok) {
        setError("BotBlocker settings could not be loaded.");
        return;
      }
      const loaded = (await response.json()) as BotBlockerSiteConfiguration;
      setConfiguration(loaded);
      setMarkers(loaded.otpMethodMarkers);
    });
    return () => {
      active = false;
    };
  }, [authenticatedFetch, projectId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const response = await authenticatedFetch(
      `/v1/projects/${projectId}/botblocker`,
      {
        method: "PATCH",
        body: JSON.stringify({
          enabled: form.get("enabled") === "on",
          decisionTimeoutMs: Number(form.get("decisionTimeoutMs")),
          otpMethodMarkers: markers,
        }),
      },
    );
    setSaving(false);
    if (!response.ok) {
      setError(
        `Use a whole-number timeout from ${BOTBLOCKER_TIMEOUT_MIN_MS} through ${BOTBLOCKER_TIMEOUT_MAX_MS} ms and give enabled OTP methods different trigger scores.`,
      );
      return;
    }
    const updated = (await response.json()) as BotBlockerSiteConfiguration;
    setConfiguration(updated);
    setMarkers(updated.otpMethodMarkers);
  }

  function updateMarker(
    method: BotBlockerOtpMethod,
    change: Partial<Pick<BotBlockerOtpMethodMarker, "enabled" | "triggerScore">>,
  ) {
    setMarkers((current) =>
      current.map((marker) =>
        marker.method === method ? { ...marker, ...change } : marker,
      ),
    );
  }

  const status = configuration?.enabled ? "Enabled" : "Disabled";

  return (
    <details className="botBlockerPanel">
      <summary>
        <span>BotBlocker</span>
        <span
          className={`statusBadge ${
            configuration?.enabled ? "statusBadgeUp" : "statusBadgeDown"
          }`}
        >
          {configuration ? status : "Loading"}
        </span>
      </summary>
      <div className="botBlockerPanelBody">
        <p>
          POWEROTP keeps this policy private and applies it server-side for
          this project. A visitor uses the highest enabled trigger at or below
          their risk score; below every enabled trigger, access is allowed.
        </p>
        {configuration && (
          <form
            className="formStack botBlockerForm"
            key={configuration.updatedAt}
            onSubmit={save}
          >
            <label className="fieldInline">
              <input
                defaultChecked={configuration.enabled}
                name="enabled"
                type="checkbox"
              />
              Enable this project&apos;s BotBlocker configuration
            </label>
            <label className="field">
              Decision timeout (milliseconds)
              <input
                defaultValue={configuration.decisionTimeoutMs}
                max={BOTBLOCKER_TIMEOUT_MAX_MS}
                min={BOTBLOCKER_TIMEOUT_MIN_MS}
                name="decisionTimeoutMs"
                required
                step="1"
                type="number"
              />
            </label>
            <fieldset className="otpPolicyFieldset">
              <legend>OTP risk score triggers</legend>
              <div className="otpPolicyScale" aria-hidden="true">
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </div>
              {markers.map((marker) => (
                <div className="otpPolicyMarker" key={marker.method}>
                  <label className="otpPolicyToggle">
                    <input
                      checked={marker.enabled}
                      onChange={(event) =>
                        updateMarker(marker.method, {
                          enabled: event.currentTarget.checked,
                        })
                      }
                      type="checkbox"
                    />
                    {methodLabels[marker.method]}
                  </label>
                  <div className="otpPolicyRange">
                    <input
                      aria-label={`${methodLabels[marker.method]} trigger score`}
                      disabled={!marker.enabled}
                      max="100"
                      min="0"
                      onChange={(event) =>
                        updateMarker(marker.method, {
                          triggerScore: Number(event.currentTarget.value),
                        })
                      }
                      type="range"
                      value={marker.triggerScore}
                    />
                    <span aria-hidden="true" className="otpPolicyArrow">▲</span>
                    <output>{marker.triggerScore}</output>
                  </div>
                </div>
              ))}
            </fieldset>
            <p>
              {BOTBLOCKER_TIMEOUT_DEFAULT_MS} ms is recommended. This is a
              responsiveness setting and never cancels a pending decision.
            </p>
            <button
              className="button buttonSmall"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving…" : "Save BotBlocker settings"}
            </button>
          </form>
        )}
        {error && <div className="formError">{error}</div>}
      </div>
    </details>
  );
}
