"use client";

import { NODE_STALE_THRESHOLD_MS, type Node, type SessionResponse } from "@powerotp/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CallbackDeliveriesPanel } from "./callback-deliveries-panel";
import { ChallengesPanel } from "./challenges-panel";
import { OpsPanel } from "./ops-panel";
import { UsagePanel } from "./usage-panel";
import { WidgetInteractionsPanel } from "./widget-interactions-panel";

function isNodeStale(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() > NODE_STALE_THRESHOLD_MS;
}

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse>();
  const [demoStatus, setDemoStatus] = useState("");
  const [nodes, setNodes] = useState<Node[]>([]);

  useEffect(() => {
    void fetch("/v1/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) {
        router.replace("/admin/login");
        return;
      }
      const result = (await response.json()) as SessionResponse;
      if (result.user.accountClass !== "platform_admin") {
        router.replace("/login");
        return;
      }
      setSession(result);
      await refreshNodes();
    });
  }, [router]);

  async function refreshNodes() {
    const response = await fetch("/v1/admin/nodes", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return;
    const { nodes: list } = (await response.json()) as { nodes: Node[] };
    setNodes(list);
  }

  async function ensureDemoProject() {
    if (!session) return;
    setDemoStatus("Provisioning…");
    const response = await fetch("/v1/admin/demo-project", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": session.csrfToken },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      setDemoStatus(
        body?.error === "demo_not_configured"
          ? "Set DEMO_PROJECT_SLUG in App Platform first."
          : "Could not provision the demo project.",
      );
      return;
    }
    const { project } = (await response.json()) as { project: { slug: string } };
    setDemoStatus(`Live demo project ready at slug "${project.slug}".`);
  }

  async function logout() {
    if (!session) return;
    await fetch("/v1/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": session.csrfToken },
    });
    router.replace("/admin/login");
  }

  return (
    <main className="dashboardPage">
      <nav className="dashboardNav shell">
        <a className="brand" href="/">
          <span className="brandMark">P</span> POWEROTP ADMIN
        </a>
        <button className="button buttonSmall buttonGhost" onClick={logout}>
          Sign out
        </button>
      </nav>
      <header className="dashboardHeader shell">
        <div>
          <span className="adminNotice">Restricted platform administration</span>
          <h1>Operations</h1>
          <p>{session?.user.email}</p>
        </div>
      </header>
      <section className="dashboardGrid shell">
        <article className="projectCard">
          <h2>Phase 2 administration boundary active</h2>
          <p>
            Customer, provider, node, media, and abuse-management controls are added
            in their implementation phases. This route already requires an administrator
            session, restricted to an allowlisted IP address.
          </p>
        </article>
        <article className="projectCard">
          <h2>Public &quot;try it now&quot; demo project</h2>
          <p>
            Creates (or refreshes) the fixed-slug project backing the anonymous demo
            widget on the marketing homepage. Safe to run more than once.
          </p>
          <button className="button buttonSmall" type="button" onClick={ensureDemoProject}>
            Provision demo project
          </button>
          {demoStatus && <p>{demoStatus}</p>}
        </article>
        <article className="projectCard">
          <h2>Telephony nodes</h2>
          <p>
            Every droplet authenticates with the shared <code>NODE_SECRET</code>{" "}
            configured in App Platform &mdash; there is nothing to enroll or revoke here.
            A node appears below automatically the first time it successfully polls for
            configuration. Adding a droplet is deploying the agent there with the current{" "}
            <code>NODE_SECRET</code>; removing access is rotating that value in App
            Platform and redeploying every node with the new one.
          </p>
          <ul className="nodeList">
            {nodes.length === 0 && <li>No node has connected yet.</li>}
            {nodes.map((node) => (
              <li key={node.id}>
                <div>
                  <strong>{node.ip}</strong>{" "}
                  <span className={isNodeStale(node.lastSeenAt) ? "statusBadge statusBadgeDown" : "statusBadge statusBadgeUp"}>
                    {isNodeStale(node.lastSeenAt) ? "stale" : "live"}
                  </span>
                  {" — first seen "}
                  {new Date(node.firstSeenAt).toLocaleString()}
                  {", last seen "}
                  {new Date(node.lastSeenAt).toLocaleString()}
                </div>
                {node.trunkStatus && node.trunkStatus.length > 0 && (
                  <table className="opsTable">
                    <thead>
                      <tr>
                        <th>Trunk</th>
                        <th>Registration</th>
                        <th>Failover health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {node.trunkStatus.map((trunk) => (
                        <tr key={trunk.id}>
                          <td>{trunk.id}</td>
                          <td>
                            <span
                              className={
                                trunk.registrationState === "Registered"
                                  ? "statusBadge statusBadgeUp"
                                  : trunk.registrationState === "Unknown"
                                    ? "statusBadge statusBadgeUnknown"
                                    : "statusBadge statusBadgeDown"
                              }
                            >
                              {trunk.registrationState}
                            </span>
                          </td>
                          <td>
                            {trunk.healthy
                              ? "healthy"
                              : `down (${trunk.consecutiveFailures} consecutive failures)`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            ))}
          </ul>
        </article>
        <OpsPanel />
        <UsagePanel />
        <CallbackDeliveriesPanel />
        <WidgetInteractionsPanel />
        {session && <ChallengesPanel csrfToken={session.csrfToken} />}
      </section>
    </main>
  );
}
