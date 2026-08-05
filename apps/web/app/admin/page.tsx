"use client";

import type { SessionResponse } from "@powerotp/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse>();
  const [demoStatus, setDemoStatus] = useState("");

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
    });
  }, [router]);

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
            session and TOTP authentication.
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
      </section>
    </main>
  );
}
