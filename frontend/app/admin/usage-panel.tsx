"use client";

import type { Project } from "@/lib/contracts";
import { useState } from "react";

import { apiFetch } from "@/lib/api-client";

type PlatformStats = Project["stats"];

/**
 * Read-only, platform-wide verification totals (every project combined) —
 * see `backend/packages/api/src/verification-reporting.ts#computePlatformStats` and
 * `docs/AS_BUILT.md`'s "Admin operator health dashboard" section. A single
 * customer's own totals are already shown on their own dashboard; this is
 * the platform-wide equivalent. Manual refresh only, matching this page's
 * other panels — no auto-polling, no charts/history.
 */
export function UsagePanel() {
  const [stats, setStats] = useState<PlatformStats>();

  async function refresh() {
    const response = await apiFetch("/v1/admin/usage", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const { stats: result } = (await response.json()) as { stats: PlatformStats };
    setStats(result);
  }

  return (
    <article className="projectCard">
      <h2>Platform usage</h2>
      <p>Verification totals across every project on the platform.</p>
      <button className="button buttonSmall" type="button" onClick={refresh}>
        {stats ? "Refresh" : "Load platform usage"}
      </button>
      {stats && (
        <>
          <div className="statsGrid">
            <div className="stat">
              <strong>{stats.total}</strong>
              <span>Total</span>
            </div>
            <div className="stat">
              <strong>{stats.succeeded}</strong>
              <span>Successful</span>
            </div>
            <div className="stat">
              <strong>{stats.failed}</strong>
              <span>Failed</span>
            </div>
          </div>
          <table className="opsTable">
            <thead>
              <tr>
                <th>Type</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.byType).map(([type, count]) => (
                <tr key={type}>
                  <td>{type}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </article>
  );
}
