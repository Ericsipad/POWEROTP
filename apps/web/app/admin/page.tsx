"use client";

import type { Node, SessionResponse } from "@powerotp/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse>();
  const [demoStatus, setDemoStatus] = useState("");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [enrolledSecret, setEnrolledSecret] = useState("");
  const [nodeStatus, setNodeStatus] = useState("");

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

  async function enrollNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const form = new FormData(event.currentTarget);
    setNodeStatus("Enrolling…");
    const response = await fetch("/v1/admin/nodes", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken },
      body: JSON.stringify({ name: form.get("name"), region: form.get("region") }),
    });
    if (!response.ok) {
      setNodeStatus("Could not enroll the node.");
      return;
    }
    const enrolled = (await response.json()) as { node: Node; secret: string };
    setEnrolledSecret(enrolled.secret);
    setNodeStatus("");
    event.currentTarget.reset();
    await refreshNodes();
  }

  async function revokeNode(nodeId: string) {
    if (!session) return;
    await fetch(`/v1/admin/nodes/${nodeId}/revoke`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": session.csrfToken },
    });
    await refreshNodes();
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
            Enroll a droplet with a hashed, revocable bearer secret. Copy the secret shown
            below into the droplet&apos;s protected agent env file &mdash; it is never shown
            again.
          </p>
          <form className="formStack" onSubmit={enrollNode}>
            <label className="field">
              Node name
              <input name="name" type="text" required minLength={2} maxLength={80} />
            </label>
            <label className="field">
              Region
              <input name="region" type="text" required minLength={2} maxLength={40} />
            </label>
            <button className="button buttonSmall" type="submit">
              Enroll node
            </button>
          </form>
          {nodeStatus && <p>{nodeStatus}</p>}
          {enrolledSecret && (
            <div className="secretPanel">
              <span>Node secret &mdash; shown once, copy it now:</span>
              <code>{enrolledSecret}</code>
            </div>
          )}
          <ul className="nodeList">
            {nodes.map((node) => (
              <li key={node.id}>
                <span className="statusChip">{node.status}</span>
                <strong>{node.name}</strong> ({node.region}) &mdash; {node.secretPrefix}
                ••••{node.secretLastFour}
                {node.lastSeenAt
                  ? ` — last seen ${new Date(node.lastSeenAt).toLocaleString()}`
                  : " — never seen"}
                {node.status === "active" && (
                  <button
                    className="button buttonSmall buttonGhost"
                    type="button"
                    onClick={() => void revokeNode(node.id)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
