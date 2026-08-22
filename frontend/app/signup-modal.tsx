"use client";

import { PASSWORD_REQUIREMENTS, type SignupResponse } from "@/lib/contracts";
import { useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api-client";
import { referralCodeFromCookie } from "@/lib/referral-cookie";

interface SignupModalProps {
  onClose(): void;
}

type Step = "form" | "submitting" | "success" | "already_registered";
const REFERRAL_COOKIE = "powerotp_referral";

/**
 * The "rapid signup" modal: email + password (entered twice), a live
 * password-requirement checklist, and — on submit — the newly issued
 * API key shown once, right in the modal. See `docs/AS_BUILT.md`'s
 * "Customer signup flow" section.
 */
export function SignupModal({ onClose }: SignupModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [identityDataMode, setIdentityDataMode] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SignupResponse>();

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const allRequirementsMet = PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(password));
  const canSubmit =
    allRequirementsMet &&
    passwordsMatch &&
    email.trim().length > 0 &&
    identityDataMode.length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError("");
    setStep("submitting");

    try {
      const response = await apiFetch("/v1/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          identityDataMode,
          referralCode: referralCodeFromCookie(document.cookie),
        }),
      });
      const data = (await response.json().catch(() => undefined)) as
        | (SignupResponse & { error?: string })
        | undefined;
      if (!response.ok || !data) {
        const messages: Record<string, string> = {
          invalid_request: "Check your email and make sure the password meets every requirement.",
          origin_not_allowed: "Signup is not available from this page.",
          rate_limited: "Too many signup attempts. Please wait a minute and try again.",
          internal_error: "Signup is temporarily unavailable. Please try again shortly.",
        };
        setError((data?.error && messages[data.error]) || "Signup could not be completed.");
        setStep("form");
        return;
      }
      setResult(data);
      setStep(data.status === "already_registered" ? "already_registered" : "success");
      if (data.status !== "already_registered") {
        document.cookie = `${REFERRAL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      }
    } catch {
      setError("Could not reach the signup API.");
      setStep("form");
    }
  }

  async function copyApiKey() {
    if (result?.apiKey) await navigator.clipboard.writeText(result.apiKey).catch(() => {});
  }

  return (
    <div className="signupModalBackdrop" onClick={onClose}>
      <div className="signupModal" onClick={(event) => event.stopPropagation()}>
        <button className="widgetCardClose" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>

        {(step === "form" || step === "submitting") && (
          <>
            <h2>Create your account</h2>
            <p>Get an API key immediately — verify your email to activate it.</p>
            <form className="formStack" onSubmit={submit}>
              <label className="field">
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                Password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                Identity data custody for your first project
                <select
                  value={identityDataMode}
                  onChange={(event) => setIdentityDataMode(event.target.value)}
                  required
                >
                  <option value="" disabled>Select a permanent custody mode</option>
                  <option value="powerotp_pii">POWEROTP stores encrypted contact data</option>
                  <option value="didit_pii">Didit stores contact data</option>
                </select>
              </label>
              <p>This choice sets the project&apos;s authentication realm and cannot be changed.</p>
              <ul className="passwordChecklist">
                {PASSWORD_REQUIREMENTS.map((requirement) => {
                  const met = requirement.test(password);
                  return (
                    <li key={requirement.id} className={met ? "passwordChecklistMet" : ""}>
                      <span aria-hidden>{met ? "✓" : "○"}</span> {requirement.label}
                    </li>
                  );
                })}
                <li className={passwordsMatch ? "passwordChecklistMet" : ""}>
                  <span aria-hidden>{passwordsMatch ? "✓" : "○"}</span> Passwords match
                </li>
              </ul>
              {error && <div className="formError">{error}</div>}
              <button className="button" type="submit" disabled={!canSubmit || step === "submitting"}>
                {step === "submitting" ? "Creating…" : "Create account"}
              </button>
            </form>
          </>
        )}

        {step === "already_registered" && (
          <>
            <h2>Check your email</h2>
            <p className="formSuccess">
              An account with this email already exists. If it&apos;s not yet verified, check your inbox
              for the activation link; otherwise sign in instead.
            </p>
          </>
        )}

        {step === "success" && result && (
          <>
            <h2>Save your API key now</h2>
            <p className="formSuccess">
              This key is shown once — copy it to a safe place. Your API key will work immediately on
              the free tier upon pressing the activation link in your email.
            </p>
            {result.apiKey ? (
              <div className="codePanel signupApiKeyPanel">
                <div className="codeTop">
                  <span>API key</span>
                  <span className="readOnly">SHOWN ONCE</span>
                </div>
                <pre>
                  <code>{result.apiKey}</code>
                </pre>
                <button className="button buttonSmall buttonGhost" type="button" onClick={copyApiKey}>
                  Copy key
                </button>
              </div>
            ) : (
              <p>
                A project already exists on this account — its API key was already shown once
                previously.
              </p>
            )}
            <p>We sent a verification link to {email}. The link expires in one hour.</p>
            <button className="button" type="button" onClick={onClose}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
