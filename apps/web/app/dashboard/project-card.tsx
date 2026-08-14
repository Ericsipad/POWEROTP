"use client";

import type { Project } from "@powerotp/contracts";
import { useState, type FormEvent } from "react";

import { VerificationTabs } from "./verification-tabs";

interface ProjectCardProps {
  project: Project;
  onRotateApiKey(projectId: string): Promise<void>;
  onSetCallback(projectId: string, callbackUrl: string): Promise<void>;
  onProjectUpdated(project: Project): void;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}

export function ProjectCard({
  project,
  onRotateApiKey,
  onSetCallback,
  onProjectUpdated,
  authenticatedFetch,
}: ProjectCardProps) {
  const [showCallback, setShowCallback] = useState(false);
  const [showOrigins, setShowOrigins] = useState(false);
  const [originsError, setOriginsError] = useState("");

  async function saveCallback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const callbackUrl = String(new FormData(event.currentTarget).get("callbackUrl"));
    await onSetCallback(project.id, callbackUrl);
    setShowCallback(false);
  }

  async function saveOrigins(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOriginsError("");
    const allowedOrigins = String(
      new FormData(event.currentTarget).get("allowedOrigins") ?? "",
    )
      .split(/[\n,]/)
      .map((origin) => origin.trim())
      .filter(Boolean);
    const response = await authenticatedFetch(`/v1/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ allowedOrigins }),
    });
    if (!response.ok) {
      setOriginsError("Origins could not be saved. Enter complete https:// URLs only.");
      return;
    }
    onProjectUpdated((await response.json()) as Project);
    setShowOrigins(false);
  }

  return (
    <article className="projectCard">
      <div className="projectTop">
        <div>
          <span className="statusChip">{project.active ? "Active" : "Paused"}</span>
          <h2>{project.name}</h2>
        </div>
        <div>
          {project.enabledMethods.map((method) => (
            <span className="methodChip" key={method}>
              {method}
            </span>
          ))}
        </div>
      </div>
      <div className="endpoint">{project.apiUrl}</div>
      <div className="projectMeta">
        <span>
          API key: {project.apiKeyPrefix ?? "none"}••••
          {project.apiKeyLastFour ?? ""}
        </span>
        <span>
          Callback: {project.callbackConfigured ? project.callbackUrl : "not configured"}
        </span>
        <span>
          Website origins: {project.allowedOrigins.length ? project.allowedOrigins.join(", ") : "not configured"}
        </span>
        <span>Activated: {new Date(project.activatedAt).toLocaleDateString()}</span>
      </div>
      <div className="statsGrid">
        <div className="stat">
          <strong>{project.stats.total}</strong>
          <span>Total</span>
        </div>
        <div className="stat">
          <strong>{project.stats.succeeded}</strong>
          <span>Successful</span>
        </div>
        <div className="stat">
          <strong>{project.stats.failed}</strong>
          <span>Failed</span>
        </div>
      </div>
      {showCallback && (
        <form className="formStack" onSubmit={saveCallback}>
          <label className="field">
            HTTPS callback URL
            <input
              name="callbackUrl"
              type="url"
              defaultValue={project.callbackUrl}
              pattern="https://.*"
              required
            />
          </label>
          <button className="button buttonSmall" type="submit">
            Save and rotate callback secret
          </button>
        </form>
      )}
      {showOrigins && (
        <form className="formStack" onSubmit={saveOrigins}>
          <label className="field">
            Allowed HTTPS website origins, one per line
            <textarea
              name="allowedOrigins"
              defaultValue={project.allowedOrigins.join("\n")}
              placeholder="https://example.com"
            />
          </label>
          <p>
            Optional. Add origins only when this project is used from a website or browser widget.
          </p>
          {originsError && <div className="formError">{originsError}</div>}
          <button className="button buttonSmall" type="submit">
            Save website origins
          </button>
        </form>
      )}
      <div className="projectActions">
        <button
          className="button buttonSmall buttonGhost"
          onClick={() => setShowCallback((current) => !current)}
          type="button"
        >
          Configure callback
        </button>
        <button
          className="button buttonSmall buttonGhost"
          onClick={() => {
            setOriginsError("");
            setShowOrigins((current) => !current);
          }}
          type="button"
        >
          Configure website origins
        </button>
        <button
          className="button buttonSmall buttonGhost"
          onClick={() => void onRotateApiKey(project.id)}
          type="button"
        >
          Rotate API key
        </button>
      </div>
      <VerificationTabs
        project={project}
        authenticatedFetch={authenticatedFetch}
        onProjectUpdated={onProjectUpdated}
      />
    </article>
  );
}
