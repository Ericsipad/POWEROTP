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

  async function saveCallback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const callbackUrl = String(new FormData(event.currentTarget).get("callbackUrl"));
    await onSetCallback(project.id, callbackUrl);
    setShowCallback(false);
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
