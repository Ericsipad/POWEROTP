"use client";

import type { InteractionSummary, Project, VerificationType } from "@powerotp/contracts";
import { useEffect, useState } from "react";

import { InteractionsTable } from "./interactions-table";
import { VisitorsPanel } from "./visitors-panel";

interface VerificationTabsProps {
  project: Project;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
  onProjectUpdated(project: Project): void;
}

const typeTabs: Array<{ id: VerificationType; label: string }> = [
  { id: "call_reachability", label: "Call reachability" },
  { id: "voice_code", label: "Voice code" },
  { id: "voice_challenge", label: "Voice challenge" },
  { id: "sms_code", label: "SMS code" },
  { id: "email_code", label: "Email code" },
];

type TabId = VerificationType | "visitors";

/**
 * Per-verification-type tabs for one project — each tab shows that type's
 * own settings (enabled/disabled, plus `email_code`'s branding fields) and
 * the same shared history table filtered to just that type, per the user's
 * exact requested shape ("tabs for each type ... settings for each and the
 * table for each history ... same table all pages but filtered for the
 * type"). A final "Visitors" tab surfaces real end-user widget interactions
 * for this project (see `VisitorsPanel`).
 */
export function VerificationTabs({ project, authenticatedFetch, onProjectUpdated }: VerificationTabsProps) {
  const [active, setActive] = useState<TabId>("call_reachability");
  const [interactions, setInteractions] = useState<InteractionSummary[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    setInteractions(undefined);
    setError("");
    if (active === "visitors") return;
    void loadInteractions(active);
  }, [active, project.id]);

  async function loadInteractions(type: VerificationType) {
    const response = await authenticatedFetch(
      `/v1/projects/${project.id}/interactions?type=${type}`,
    );
    if (!response.ok) {
      setError("Interaction history could not be loaded.");
      return;
    }
    const result = (await response.json()) as { interactions: InteractionSummary[] };
    setInteractions(result.interactions);
  }

  async function toggleEnabled(type: VerificationType, enabled: boolean) {
    const nextMethods = enabled
      ? [...project.enabledMethods, type]
      : project.enabledMethods.filter((method) => method !== type);
    if (nextMethods.length === 0) return;
    const response = await authenticatedFetch(`/v1/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabledMethods: nextMethods }),
    });
    if (response.ok) onProjectUpdated((await response.json()) as Project);
  }

  return (
    <div className="verificationTabs">
      <div className="tabBar">
        {typeTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tabButton${active === tab.id ? " tabButtonActive" : ""}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className={`tabButton${active === "visitors" ? " tabButtonActive" : ""}`}
          onClick={() => setActive("visitors")}
        >
          Visitors
        </button>
      </div>

      {active !== "visitors" && (
        <div className="tabPanel">
          <label className="field fieldInline">
            <input
              type="checkbox"
              checked={project.enabledMethods.includes(active)}
              onChange={(event) => toggleEnabled(active, event.target.checked)}
            />
            Enabled for this project
          </label>

          {active === "email_code" && (
            <BrandingForm
              project={project}
              authenticatedFetch={authenticatedFetch}
              onProjectUpdated={onProjectUpdated}
            />
          )}

          <h3>History</h3>
          <InteractionsTable interactions={interactions} error={error} />
        </div>
      )}

      {active === "visitors" && (
        <VisitorsPanel projectId={project.id} authenticatedFetch={authenticatedFetch} />
      )}
    </div>
  );
}

function BrandingForm({
  project,
  authenticatedFetch,
  onProjectUpdated,
}: {
  project: Project;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
  onProjectUpdated(project: Project): void;
}) {
  const [brandName, setBrandName] = useState(project.brandName ?? "");
  const [brandLogoUrl, setBrandLogoUrl] = useState(project.brandLogoUrl ?? "");
  const [status, setStatus] = useState("");

  async function save() {
    const response = await authenticatedFetch(`/v1/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        brandName: brandName.trim() || null,
        brandLogoUrl: brandLogoUrl.trim() || null,
      }),
    });
    if (response.ok) {
      onProjectUpdated((await response.json()) as Project);
      setStatus("Branding saved.");
    } else {
      setStatus("Branding could not be saved — check the logo URL is a real HTTPS link.");
    }
  }

  return (
    <div className="formStack brandingForm">
      <p>
        Shown on the verification-code emails sent to your own end users — never
        anywhere else. Paste a link to an already-hosted logo image; there is no
        file upload yet.
      </p>
      <label className="field">
        Brand name
        <input
          value={brandName}
          onChange={(event) => setBrandName(event.target.value)}
          placeholder="Acme Corp"
          maxLength={80}
        />
      </label>
      <label className="field">
        Logo URL (HTTPS)
        <input
          type="url"
          value={brandLogoUrl}
          onChange={(event) => setBrandLogoUrl(event.target.value)}
          placeholder="https://example.com/logo.png"
          pattern="https://.*"
        />
      </label>
      <button className="button buttonSmall" type="button" onClick={save}>
        Save branding
      </button>
      {status && <p>{status}</p>}
    </div>
  );
}
