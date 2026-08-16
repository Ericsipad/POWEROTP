"use client";

import type { CallbackDeliverySummary } from "@/lib/contracts";
import { useState } from "react";

import { apiFetch } from "@/lib/api-client";

/**
 * Read-only visibility into recent callback delivery attempts (both
 * delivered and failed), most recent first — see
 * `backend/packages/api/src/callback-worker.ts` (which already records every attempt)
 * and `docs/AS_BUILT.md`'s "Admin operator health dashboard" section.
 * Diagnostics visibility only — no manual retry, per explicit scope for
 * this session. Manual refresh only, matching this page's other panels.
 */
export function CallbackDeliveriesPanel() {
  const [deliveries, setDeliveries] = useState<CallbackDeliverySummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const response = await apiFetch("/v1/admin/callback-deliveries", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const { deliveries: list } = (await response.json()) as {
      deliveries: CallbackDeliverySummary[];
    };
    setDeliveries(list);
    setLoaded(true);
  }

  return (
    <article className="projectCard">
      <h2>Callback delivery diagnostics</h2>
      <p>
        The most recent {deliveries.length > 0 ? deliveries.length : 50} callback delivery
        attempts across every project, most recent first.
      </p>
      <button className="button buttonSmall" type="button" onClick={refresh}>
        {loaded ? "Refresh" : "Load recent callback deliveries"}
      </button>
      {loaded && (
        <table className="opsTable">
          <thead>
            <tr>
              <th>Occurred</th>
              <th>Project</th>
              <th>Interaction</th>
              <th>Attempt</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={6}>No callback deliveries recorded yet.</td>
              </tr>
            )}
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td>{new Date(delivery.occurredAt).toLocaleString()}</td>
                <td>{delivery.projectId}</td>
                <td>{delivery.interactionId}</td>
                <td>{delivery.attempt}</td>
                <td>
                  <span
                    className={
                      delivery.status === "delivered"
                        ? "statusBadge statusBadgeUp"
                        : "statusBadge statusBadgeDown"
                    }
                  >
                    {delivery.status}
                  </span>
                </td>
                <td>
                  {delivery.statusCode ?? ""} {delivery.error ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
