"use client";

import type { ProjectAuditEvent } from "@/lib/contracts";
import { useEffect, useState } from "react";

interface Props {
  projectId: string;
  refreshVersion: number;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}

function eventLabel(action: string): string {
  return action.replaceAll(".", " · ").replaceAll("_", " ");
}

export function ProjectAuditHistory({
  projectId,
  refreshVersion,
  authenticatedFetch,
}: Props) {
  const [events, setEvents] = useState<ProjectAuditEvent[]>([]);

  useEffect(() => {
    void authenticatedFetch(`/v1/projects/${projectId}/audit-history`, {
      cache: "no-store",
    }).then(async (response) => {
      if (response.ok) {
        const body = (await response.json()) as { events: ProjectAuditEvent[] };
        setEvents(body.events);
      }
    });
  }, [projectId, refreshVersion]);

  return (
    <div className="auditHistory">
      <h4>Recent configuration and security history</h4>
      {events.length === 0 ? (
        <p>No project events yet.</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              <span>{eventLabel(event.action)}</span>
              <time dateTime={event.occurredAt}>
                {new Date(event.occurredAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
