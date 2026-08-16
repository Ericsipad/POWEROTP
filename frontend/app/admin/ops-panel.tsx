"use client";

import type { QueueCounts } from "@/lib/contracts";
import { useState } from "react";

import { apiFetch } from "@/lib/api-client";

/**
 * Read-only BullMQ queue-depth snapshot for the admin "operator health"
 * view — see `backend/packages/api/src/verification-queue.ts#getQueueCounts` and
 * `docs/AS_BUILT.md`'s "Admin operator health dashboard" section. Manual
 * refresh only, matching this page's other panels — no auto-polling.
 */
export function OpsPanel() {
  const [queues, setQueues] = useState<QueueCounts[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const response = await apiFetch("/v1/admin/queues", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const { queues: list } = (await response.json()) as { queues: QueueCounts[] };
    setQueues(list);
    setLoaded(true);
  }

  return (
    <article className="projectCard">
      <h2>Background queue depth</h2>
      <p>
        Current BullMQ job counts for every queue this app runs. A large or growing{" "}
        <code>waiting</code>/<code>failed</code> count on an otherwise-healthy site usually
        means a worker stopped processing.
      </p>
      <button className="button buttonSmall" type="button" onClick={refresh}>
        {loaded ? "Refresh" : "Load queue depth"}
      </button>
      {loaded && (
        <table className="opsTable">
          <thead>
            <tr>
              <th>Queue</th>
              <th>Waiting</th>
              <th>Active</th>
              <th>Delayed</th>
              <th>Failed</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {queues.map((queue) => (
              <tr key={queue.name}>
                <td>{queue.name}</td>
                <td>{queue.waiting}</td>
                <td>{queue.active}</td>
                <td>{queue.delayed}</td>
                <td>{queue.failed}</td>
                <td>{queue.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
