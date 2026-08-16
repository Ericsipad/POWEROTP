"use client";

import {
  BOTBLOCKER_TIMEOUT_DEFAULT_MS,
  BOTBLOCKER_TIMEOUT_MAX_MS,
  BOTBLOCKER_TIMEOUT_MIN_MS,
  type BotBlockerSiteConfiguration,
} from "@/lib/contracts";
import { useEffect, useState, type FormEvent } from "react";

interface BotBlockerPanelProps {
  projectId: string;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}

export function BotBlockerPanel({
  projectId,
  authenticatedFetch,
}: BotBlockerPanelProps) {
  const [configuration, setConfiguration] =
    useState<BotBlockerSiteConfiguration>();
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
      setConfiguration(
        (await response.json()) as BotBlockerSiteConfiguration,
      );
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
        }),
      },
    );
    setSaving(false);
    if (!response.ok) {
      setError(
        `Enter a whole-number timeout from ${BOTBLOCKER_TIMEOUT_MIN_MS} through ${BOTBLOCKER_TIMEOUT_MAX_MS} ms.`,
      );
      return;
    }
    setConfiguration(
      (await response.json()) as BotBlockerSiteConfiguration,
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
          Configuration only. Customer traffic remains inactive until the
          production BotBlocker runtime is ready and deployed.
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
