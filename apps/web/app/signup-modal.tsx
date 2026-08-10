"use client";

import { PASSWORD_REQUIREMENTS, type SignupResponse } from "@powerotp/contracts";
import { useState, type FormEvent } from "react";

interface SignupModalProps {
  onClose(): void;
}

type Step = "form" | "submitting" | "success" | "already_registered";

/**
 * The "rapid signup" modal: email + password (entered twice) + website,
 * live password-requirement checklist, and — on submit — the newly issued
 * API key shown once, right in the modal. See `docs/AS_BUILT.md`'s
 * "Customer signup flow" section.
 */
export function SignupModal({ onClose }: SignupModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [website, setWebsite] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SignupResponse>();

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const allRequirementsMet = PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(password));
  const canSubmit = allRequirementsMet && passwordsMatch && email.trim().length > 0 && website.trim().length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError("");
    setStep("submitting");

    const normalizedWebsite = /^https?:\/\//.test(website.trim())
      ? website.trim()
      : `https://${website.trim()}`;

    try {
      const response = await fetch("/v1/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, website: normalizedWebsite }),
      });
      const data = (await response.json().catch(() => undefined)) as SignupResponse | undefined;
      if (!response.ok || !data) {
        setError("Signup could not be completed. Check the entered details, including that your website is a valid https:// URL.");
        setStep("form");
        return;
      }
      setResult(data);
      setStep(data.status === "already_registered" ? "already_registered" : "success");
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
              <label className="field">
                Website
                <input
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://your website"
                  required
                />
              </label>
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
