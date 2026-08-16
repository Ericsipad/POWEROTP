"use client";

import type { WidgetInteractionSummary } from "@/lib/contracts";
import { useEffect, useState } from "react";

interface VisitorsPanelProps {
  projectId: string;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}

/**
 * Customer-facing "Visitors" tab — every real end user who reached this
 * project's hosted verification modal, with the same IP/User-Agent
 * visibility already surfaced admin-side (see
 * `frontend/app/admin/widget-interactions-panel.tsx`), scoped to just this
 * project. A "Threat score" column is scaffolded but intentionally always
 * shows "Coming soon" — no scoring model exists yet; this is deliberately
 * just the framing for that future phase, not the real feature.
 */
export function VisitorsPanel({ projectId, authenticatedFetch }: VisitorsPanelProps) {
  const [interactions, setInteractions] = useState<WidgetInteractionSummary[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
  }, [projectId]);

  async function load() {
    const response = await authenticatedFetch(`/v1/projects/${projectId}/visitors`);
    if (!response.ok) {
      setError("Visitor history could not be loaded.");
      return;
    }
    const result = (await response.json()) as { interactions: WidgetInteractionSummary[] };
    setInteractions(result.interactions);
  }

  const uniqueIps = new Set((interactions ?? []).map((row) => row.endUserIp).filter(Boolean)).size;

  return (
    <div className="tabPanel">
      <p>
        Real end users who reached this project&apos;s hosted verification modal —
        never traffic your own backend created directly. Visibility only for now;
        threat scoring is planned but not built yet.
      </p>
      <div className="statsGrid">
        <div className="stat">
          <strong>{interactions?.length ?? "—"}</strong>
          <span>Visits</span>
        </div>
        <div className="stat">
          <strong>{interactions ? uniqueIps : "—"}</strong>
          <span>Unique IPs</span>
        </div>
      </div>
      {error && <div className="formError">{error}</div>}
      {!error && !interactions && <p>Loading…</p>}
      {!error && interactions && interactions.length === 0 && <p>No visitors recorded yet.</p>}
      {!error && interactions && interactions.length > 0 && (
        <table className="timelineTable">
          <thead>
            <tr>
              <th>Occurred</th>
              <th>Type</th>
              <th>State</th>
              <th>Target</th>
              <th>IP</th>
              <th>User-Agent</th>
              <th>Threat score</th>
            </tr>
          </thead>
          <tbody>
            {interactions.map((row) => (
              <tr key={row.interactionId}>
                <td>{new Date(row.occurredAt).toLocaleString()}</td>
                <td>{row.type}</td>
                <td>{row.state}</td>
                <td>{row.maskedTarget}</td>
                <td>{row.endUserIp ?? "—"}</td>
                <td>{row.endUserUserAgent ?? "—"}</td>
                <td className="mutedCell">Coming soon</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
