"use client";

import type { InteractionSummary } from "@powerotp/contracts";
import { useEffect, useState } from "react";

interface InteractionTimelineProps {
  projectId: string;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}

const stateLabels: Record<InteractionSummary["state"], string> = {
  queued: "Queued",
  dispatching: "Dispatching",
  calling: "Calling",
  ringing: "Ringing",
  answered: "Answered",
  playing: "Playing",
  awaiting_response: "Awaiting response",
  succeeded: "Succeeded",
  failed: "Failed",
  expired: "Expired",
  canceled: "Canceled",
};

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) return "—";
  return `${Math.round(durationMs / 1_000)}s`;
}

export function InteractionTimeline({ projectId, authenticatedFetch }: InteractionTimelineProps) {
  const [interactions, setInteractions] = useState<InteractionSummary[]>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || interactions) return;
    void load();
  }, [open]);

  async function load() {
    const response = await authenticatedFetch(`/v1/projects/${projectId}/interactions`);
    if (!response.ok) {
      setError("Interaction history could not be loaded.");
      return;
    }
    const result = (await response.json()) as { interactions: InteractionSummary[] };
    setInteractions(result.interactions);
  }

  return (
    <div className="interactionTimeline">
      <button
        className="button buttonSmall buttonGhost"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Hide" : "Show"} interaction timeline
      </button>
      {open && (
        <>
          {error && <div className="formError">{error}</div>}
          {!error && !interactions && <p>Loading…</p>}
          {!error && interactions && interactions.length === 0 && (
            <p>No interactions yet.</p>
          )}
          {!error && interactions && interactions.length > 0 && (
            <table className="timelineTable">
              <thead>
                <tr>
                  <th>Interaction</th>
                  <th>Time</th>
                  <th>Method</th>
                  <th>State</th>
                  <th>Target</th>
                  <th>Duration</th>
                  <th>Correlation</th>
                </tr>
              </thead>
              <tbody>
                {interactions.map((interaction) => (
                  <tr key={interaction.interactionId}>
                    <td>{interaction.interactionId}</td>
                    <td>{new Date(interaction.occurredAt).toLocaleString()}</td>
                    <td>{interaction.type}</td>
                    <td>{stateLabels[interaction.state]}</td>
                    <td>{interaction.maskedTarget}</td>
                    <td>{formatDuration(interaction.durationMs)}</td>
                    <td>{interaction.correlationId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
