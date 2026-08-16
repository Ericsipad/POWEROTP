"use client";

import type { WidgetInteractionSummary } from "@/lib/contracts";
import { useState } from "react";

import { apiFetch } from "@/lib/api-client";

/**
 * Read-only visibility into recent real end-user widget interactions —
 * `endUserIp`/`endUserUserAgent` are captured directly from the end user's
 * own browser request to the hosted verification modal, never from
 * anything a customer's site could set itself. Visibility/audit only for
 * now, no fraud/risk logic attached to this yet — see `docs/AS_BUILT.md`'s
 * "Hosted verification modal" section. Manual refresh only, matching this
 * page's other panels.
 */
export function WidgetInteractionsPanel() {
  const [interactions, setInteractions] = useState<WidgetInteractionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const response = await apiFetch("/v1/admin/widget-interactions", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const { interactions: list } = (await response.json()) as {
      interactions: WidgetInteractionSummary[];
    };
    setInteractions(list);
    setLoaded(true);
  }

  return (
    <article className="projectCard">
      <h2>Widget interactions</h2>
      <p>
        The most recent {interactions.length > 0 ? interactions.length : 50} real end-user
        interactions with any project&apos;s hosted verification modal, most recent first — IP
        and User-Agent are captured directly from the end user&apos;s own browser request, never
        from anything a customer&apos;s site sends. Visibility only; nothing here blocks or
        scores anything yet.
      </p>
      <button className="button buttonSmall" type="button" onClick={refresh}>
        {loaded ? "Refresh" : "Load recent widget interactions"}
      </button>
      {loaded && (
        <table className="opsTable">
          <thead>
            <tr>
              <th>Occurred</th>
              <th>Type</th>
              <th>State</th>
              <th>Target</th>
              <th>End-user IP</th>
              <th>User-Agent</th>
            </tr>
          </thead>
          <tbody>
            {interactions.length === 0 && (
              <tr>
                <td colSpan={6}>No widget interactions recorded yet.</td>
              </tr>
            )}
            {interactions.map((interaction) => (
              <tr key={interaction.interactionId}>
                <td>{new Date(interaction.occurredAt).toLocaleString()}</td>
                <td>{interaction.type}</td>
                <td>{interaction.state}</td>
                <td>{interaction.maskedTarget}</td>
                <td>{interaction.endUserIp ?? ""}</td>
                <td>{interaction.endUserUserAgent ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
