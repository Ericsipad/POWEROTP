"use client";

import type { InteractionSummary } from "@/lib/contracts";

interface InteractionsTableProps {
  interactions: InteractionSummary[] | undefined;
  error?: string;
  emptyLabel?: string;
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

/**
 * The one shared interaction-history table used by every per-type
 * dashboard tab (see `frontend/app/dashboard/verification-tabs.tsx`) —
 * same columns/shape as the old `InteractionTimeline`, just fed rows
 * directly instead of fetching/showing-hiding itself, since each tab
 * already owns its own fetch (filtered by `?type=`) and visibility.
 */
export function InteractionsTable({ interactions, error, emptyLabel }: InteractionsTableProps) {
  if (error) return <div className="formError">{error}</div>;
  if (!interactions) return <p>Loading…</p>;
  if (interactions.length === 0) return <p>{emptyLabel ?? "No interactions yet."}</p>;

  return (
    <table className="timelineTable">
      <thead>
        <tr>
          <th>Interaction</th>
          <th>Time</th>
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
            <td>{stateLabels[interaction.state]}</td>
            <td>{interaction.maskedTarget}</td>
            <td>{formatDuration(interaction.durationMs)}</td>
            <td>{interaction.correlationId ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
