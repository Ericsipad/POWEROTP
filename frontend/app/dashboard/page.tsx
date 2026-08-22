"use client";

import type {
  Project,
  ProjectCreated,
  SessionResponse,
  VerificationType,
} from "@/lib/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api-client";

import { TopBanner } from "../top-banner";
import { BillingPanel } from "./billing-panel";
import { ReferralPanel } from "./referral-panel";
import { ProjectCard } from "./project-card";

const methods: Array<{ id: VerificationType; label: string }> = [
  { id: "call_reachability", label: "Call reachability" },
  { id: "voice_code", label: "Voice code" },
  { id: "voice_challenge", label: "Voice challenge" },
  { id: "sms_code", label: "SMS code" },
  { id: "email_code", label: "Email code" },
];

interface RevealedSecrets {
  title: string;
  apiKey?: string;
  callbackSigningSecret?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [secrets, setSecrets] = useState<RevealedSecrets>();
  const [error, setError] = useState("");
  const [topupBanner, setTopupBanner] = useState<"success" | "canceled">();

  useEffect(() => {
    void load();

    // Stripe redirects back here after a top-up attempt (see
    // backend/packages/api/src/stripe-service.ts's success_url/cancel_url) — the
    // redirect itself never credits anything, it's just this one-off
    // confirmation banner. Strip the query param so a page refresh doesn't
    // re-show it.
    const topup = new URLSearchParams(window.location.search).get("topup");
    if (topup === "success" || topup === "canceled") {
      setTopupBanner(topup);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function load() {
    const sessionResponse = await apiFetch("/v1/auth/session", {
      cache: "no-store",
    });
    if (!sessionResponse.ok) {
      router.replace("/login");
      return;
    }
    const currentSession = (await sessionResponse.json()) as SessionResponse;
    setSession(currentSession);

    const projectsResponse = await apiFetch("/v1/projects", {
      cache: "no-store",
    });
    if (!projectsResponse.ok) {
      setError("Projects could not be loaded.");
      return;
    }
    const result = (await projectsResponse.json()) as { projects: Project[] };
    setProjects(result.projects);
  }

  async function authenticatedFetch(url: string, init: RequestInit = {}) {
    if (!session) throw new Error("Session not loaded");
    return apiFetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
        ...init.headers,
      },
    });
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const callbackUrl = String(form.get("callbackUrl") ?? "").trim();
    const response = await authenticatedFetch("/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        identityDataMode: form.get("identityDataMode"),
        callbackUrl: callbackUrl || undefined,
        allowedOrigins: String(form.get("allowedOrigins") ?? "")
          .split(/[\n,]/)
          .map((origin) => origin.trim())
          .filter(Boolean),
        enabledMethods: form.getAll("enabledMethods"),
      }),
    });
    if (!response.ok) {
      setError("Project could not be created. Check URLs and selected methods.");
      return;
    }

    const created = (await response.json()) as ProjectCreated;
    setProjects((current) => [created.project, ...current]);
    setSecrets({
      title: `${created.project.name} credentials`,
      apiKey: created.apiKey,
      callbackSigningSecret: created.callbackSigningSecret,
    });
    setCreating(false);
  }

  async function rotateApiKey(projectId: string) {
    const response = await authenticatedFetch(
      `/v1/projects/${projectId}/rotate-api-key`,
      { method: "POST" },
    );
    if (!response.ok) {
      setError("API key rotation failed.");
      return;
    }
    const result = (await response.json()) as { value: string };
    setSecrets({ title: "New API key", apiKey: result.value });
    await load();
  }

  async function setCallback(projectId: string, callbackUrl: string) {
    const response = await authenticatedFetch(`/v1/projects/${projectId}/callback`, {
      method: "POST",
      body: JSON.stringify({ callbackUrl }),
    });
    if (!response.ok) {
      setError("Callback configuration failed. HTTPS is required.");
      return;
    }
    const result = (await response.json()) as { value: string };
    setSecrets({
      title: "New callback signing secret",
      callbackSigningSecret: result.value,
    });
    await load();
  }

  async function logout() {
    await authenticatedFetch("/v1/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <main className="dashboardPage">
      {topupBanner && (
        <TopBanner
          tone={topupBanner === "success" ? "success" : "info"}
          message={
            topupBanner === "success"
              ? "Top-up successful — your balance will update within a few moments."
              : "Top-up canceled."
          }
          onClose={() => setTopupBanner(undefined)}
        />
      )}
      <nav className="dashboardNav shell">
        <a className="brand" href="/">
          <span className="brandMark">P</span> POWEROTP
        </a>
        <button className="button buttonSmall buttonGhost" onClick={logout}>
          Sign out
        </button>
      </nav>
      <header className="dashboardHeader shell">
        <div>
          <span className="sectionLabel">Customer dashboard</span>
          <h1>Projects</h1>
          <p>{session?.user.email}</p>
        </div>
        <button className="button" onClick={() => setCreating(true)}>
          Create project
        </button>
      </header>
      <section className="dashboardGrid shell">
        {error && <div className="formError">{error}</div>}
        {session && <BillingPanel authenticatedFetch={authenticatedFetch} />}
        {session && <ReferralPanel authenticatedFetch={authenticatedFetch} />}
        {!projects.length && !error && (
          <div className="emptyState">Create your first POWEROTP project.</div>
        )}
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onRotateApiKey={rotateApiKey}
            onSetCallback={setCallback}
            onProjectUpdated={(updated) =>
              setProjects((current) => current.map((p) => (p.id === updated.id ? updated : p)))
            }
            authenticatedFetch={authenticatedFetch}
          />
        ))}
      </section>

      {creating && (
        <div className="modalBackdrop">
          <form className="modal formStack" onSubmit={createProject}>
            <h2>Create project</h2>
            <label className="field">
              Name
              <input name="name" minLength={2} required />
            </label>
            <label className="field">
              Identity data custody
              <select name="identityDataMode" required defaultValue="">
                <option value="" disabled>Select a permanent custody mode</option>
                <option value="powerotp_pii">POWEROTP stores encrypted contact data</option>
                <option value="didit_pii">Didit stores contact data</option>
              </select>
            </label>
            <p>This choice sets the project&apos;s authentication realm and cannot be changed.</p>
            <div className="methodOptions">
              {methods.map((method) => (
                <label key={method.id}>
                  <input
                    name="enabledMethods"
                    type="checkbox"
                    value={method.id}
                    defaultChecked={method.id === "call_reachability"}
                  />
                  {method.label}
                </label>
              ))}
            </div>
            <label className="field">
              HTTPS callback URL
              <input name="callbackUrl" type="url" pattern="https://.*" />
            </label>
            <label className="field">
              Allowed HTTPS origins, one per line
              <textarea name="allowedOrigins" />
            </label>
            <div className="projectActions">
              <button className="button" type="submit">
                Create and reveal credentials
              </button>
              <button
                className="button buttonGhost"
                onClick={() => setCreating(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {secrets && (
        <div className="modalBackdrop">
          <section className="modal">
            <h2>{secrets.title}</h2>
            <p>Copy these values now. POWEROTP will not display them again.</p>
            <div className="secretPanel">
              {secrets.apiKey && <code>{secrets.apiKey}</code>}
              {secrets.callbackSigningSecret && (
                <code>{secrets.callbackSigningSecret}</code>
              )}
            </div>
            <button className="button" onClick={() => setSecrets(undefined)}>
              I saved these securely
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
