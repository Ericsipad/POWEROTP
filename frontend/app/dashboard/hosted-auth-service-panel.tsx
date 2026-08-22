"use client";

import type {
  CustomerBalance,
  HostedAuthProjectSettings,
  HostedAuthReturnUrls,
  Project,
} from "@/lib/contracts";
import { useState, type FormEvent } from "react";

import { ProjectAuditHistory } from "./project-audit-history";
import { HostedAuthStaticDetails } from "./hosted-auth-static-details";

interface Props {
  project: Project;
  balance?: CustomerBalance;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
  onProjectUpdated(project: Project): void;
}

const returnUrlFields: Array<{
  name: keyof HostedAuthReturnUrls;
  label: string;
}> = [
  { name: "signupReturnUrl", label: "Sign-up success URL" },
  { name: "signinReturnUrl", label: "Sign-in success URL" },
  { name: "failureReturnUrl", label: "Failure URL" },
  { name: "recoveryReturnUrl", label: "Recovery success URL" },
  { name: "restartUrl", label: "Restart URL" },
];

export function HostedAuthServicePanel({
  project,
  balance,
  authenticatedFetch,
  onProjectUpdated,
}: Props) {
  const [auditRefreshVersion, setAuditRefreshVersion] = useState(0);
  const [settingsStatus, setSettingsStatus] = useState("");
  const [urlsStatus, setUrlsStatus] = useState("");

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsStatus("Saving…");
    const form = new FormData(event.currentTarget);
    const minimumAge = String(form.get("minimumAge") ?? "").trim();
    const settings: HostedAuthProjectSettings = {
      signupEnabled: form.get("signupEnabled") === "on",
      signinEnabled: form.get("signinEnabled") === "on",
      methodPolicy: {
        signupContactMethods: form.getAll("signupContactMethods") as Array<
          "email" | "phone"
        >,
        signinMethods: [
          "passkey",
          ...(form.getAll("signinMethods") as Array<
            "email" | "phone" | "biometric"
          >),
        ],
      },
      assurancePolicy: {
        minimumAge: minimumAge ? Number(minimumAge) : null,
        identityKycRequired: form.get("identityKycRequired") === "on",
        livenessRequired: form.get("livenessRequired") === "on",
      },
      backendIpAllowlist: String(form.get("backendIpAllowlist") ?? "")
        .split(/[\n,]/)
        .map((cidr) => cidr.trim())
        .filter(Boolean),
    };
    const response = await authenticatedFetch(
      `/v1/projects/${project.id}/auth-settings`,
      { method: "PATCH", body: JSON.stringify(settings) },
    );
    if (!response.ok) {
      setSettingsStatus(
        "Settings were rejected. Keep at least one contact method and use canonical IPv4/IPv6 CIDRs.",
      );
      return;
    }
    const authSettings = (await response.json()) as HostedAuthProjectSettings;
    onProjectUpdated({ ...project, authSettings });
    setSettingsStatus("Hosted service settings saved.");
    setAuditRefreshVersion((current) => current + 1);
  }

  async function saveReturnUrls(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUrlsStatus("Saving…");
    const form = new FormData(event.currentTarget);
    const authReturnUrls = Object.fromEntries(
      returnUrlFields.map(({ name }) => [name, String(form.get(name) ?? "")]),
    ) as unknown as HostedAuthReturnUrls;
    const response = await authenticatedFetch(
      `/v1/projects/${project.id}/auth-return-urls`,
      { method: "PUT", body: JSON.stringify(authReturnUrls) },
    );
    if (!response.ok) {
      setUrlsStatus("Use exact approved HTTPS URLs without fragments or wildcard hosts.");
      return;
    }
    const saved = (await response.json()) as HostedAuthReturnUrls;
    onProjectUpdated({ ...project, authReturnUrls: saved });
    setUrlsStatus("Return URLs saved.");
    setAuditRefreshVersion((current) => current + 1);
  }

  const { authSettings } = project;
  const diditEnabled =
    authSettings.assurancePolicy.minimumAge !== null ||
    authSettings.assurancePolicy.identityKycRequired ||
    authSettings.assurancePolicy.livenessRequired;
  const modeIsPowerOtp = project.identityDataMode === "powerotp_pii";

  return (
    <section className="hostedAuthPanel">
      <div className="hostedAuthHeading">
        <div>
          <h3>Hosted credential services</h3>
          <span className="modeBadge">
            {modeIsPowerOtp ? "POWEROTP custody" : "Didit custody"}
          </span>
        </div>
        <div className="balanceVisibility">
          <strong>{balance ? `$${balance.balanceUsd.toFixed(2)}` : "Loading…"}</strong>
          <span>Prepaid balance for paid methods</span>
        </div>
      </div>
      <p>
        {modeIsPowerOtp
          ? "POWEROTP encrypts and stores recoverable contact data in the authx realm."
          : "Didit retains contact data; POWEROTP stores non-recoverable lookup values in the authz realm."}
        {" "}This identity-data mode is permanent. Create a new project to use the other
        custody mode.
      </p>

      <form
        className="formStack"
        key={JSON.stringify(authSettings)}
        onSubmit={saveSettings}
      >
        <div className="serviceControlGrid">
          <fieldset className="serviceControl">
            <legend>Sign-up as a Service</legend>
            <label className="fieldInline">
              <input
                defaultChecked={authSettings.signupEnabled}
                name="signupEnabled"
                type="checkbox"
              />
              Enabled
            </label>
            <span
              className={`statusBadge ${
                authSettings.signupEnabled ? "statusBadgeUp" : "statusBadgeDown"
              }`}
            >
              {authSettings.signupEnabled ? "Enabled" : "Disabled"}
            </span>
            <label className="fieldInline">
              <input
                defaultChecked={authSettings.methodPolicy.signupContactMethods.includes("email")}
                name="signupContactMethods"
                type="checkbox"
                value="email"
              />
              Email contact
            </label>
            <label className="fieldInline">
              <input
                defaultChecked={authSettings.methodPolicy.signupContactMethods.includes("phone")}
                name="signupContactMethods"
                type="checkbox"
                value="phone"
              />
              Phone contact
            </label>
          </fieldset>

          <fieldset className="serviceControl">
            <legend>Sign-in as a Service</legend>
            <label className="fieldInline">
              <input
                defaultChecked={authSettings.signinEnabled}
                name="signinEnabled"
                type="checkbox"
              />
              Enabled
            </label>
            <span
              className={`statusBadge ${
                authSettings.signinEnabled ? "statusBadgeUp" : "statusBadgeDown"
              }`}
            >
              {authSettings.signinEnabled ? "Enabled" : "Disabled"}
            </span>
            {(["passkey", "email", "phone", "biometric"] as const).map((method) => (
              <label className="fieldInline" key={method}>
                <input
                  checked={method === "passkey" ? true : undefined}
                  defaultChecked={
                    method === "passkey"
                      ? undefined
                      : authSettings.methodPolicy.signinMethods.includes(method)
                  }
                  disabled={method === "passkey"}
                  name="signinMethods"
                  type="checkbox"
                  value={method}
                />
                {method === "passkey" ? "Passkey (required)" : method}
              </label>
            ))}
          </fieldset>

          <fieldset className="serviceControl">
            <legend>Didit age / identity</legend>
            <span
              className={`statusBadge ${
                diditEnabled ? "statusBadgeUp" : "statusBadgeDown"
              }`}
            >
              {diditEnabled ? "Enabled" : "Disabled"}
            </span>
            <label className="field">
              Minimum age
              <input
                defaultValue={authSettings.assurancePolicy.minimumAge ?? ""}
                max="120"
                min="1"
                name="minimumAge"
                placeholder="Not required"
                type="number"
              />
            </label>
            <label className="fieldInline">
              <input
                defaultChecked={authSettings.assurancePolicy.identityKycRequired}
                name="identityKycRequired"
                type="checkbox"
              />
              Require identity/KYC
            </label>
            <label className="fieldInline">
              <input
                defaultChecked={authSettings.assurancePolicy.livenessRequired}
                name="livenessRequired"
                type="checkbox"
              />
              Require liveness
            </label>
          </fieldset>
        </div>

        <label className="field">
          Backend IPv4/IPv6 allowlist, one CIDR per line
          <textarea
            defaultValue={authSettings.backendIpAllowlist.join("\n")}
            name="backendIpAllowlist"
            placeholder="Optional — empty supports serverless backends"
          />
        </label>
        <button className="button buttonSmall" type="submit">
          Save hosted service settings
        </button>
        {settingsStatus && <p>{settingsStatus}</p>}
      </form>

      <HostedAuthStaticDetails project={project} />

      <form
        className="formStack returnUrlForm"
        key={JSON.stringify(project.authReturnUrls)}
        onSubmit={saveReturnUrls}
      >
        <h4>Exact browser return URLs</h4>
        {returnUrlFields.map(({ name, label }) => (
          <label className="field" key={name}>
            {label}
            <input
              defaultValue={project.authReturnUrls?.[name] ?? ""}
              name={name}
              required
              type="url"
            />
          </label>
        ))}
        <button className="button buttonSmall" type="submit">Save return URLs</button>
        {urlsStatus && <p>{urlsStatus}</p>}
      </form>

      <ProjectAuditHistory
        authenticatedFetch={authenticatedFetch}
        projectId={project.id}
        refreshVersion={auditRefreshVersion}
      />
    </section>
  );
}
