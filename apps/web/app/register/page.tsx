"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function RegisterPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });

    if (!response.ok) {
      setError("Registration could not be completed. Check the entered details.");
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="authPage">
      <section className="authCard">
        <Link className="brand" href="/">
          <span className="brandMark">P</span> POWEROTP
        </Link>
        <h1>Create account</h1>
        <p>Create your customer login. We will verify your email before access.</p>
        {status === "sent" ? (
          <p className="formSuccess">
            Check your email for the verification link. The link expires in one hour.
          </p>
        ) : (
          <form className="formStack" onSubmit={submit}>
            <label className="field">
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="field">
              Password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
            </label>
            <p>
              Use at least 12 characters with uppercase, lowercase, and a number.
            </p>
            {error && <div className="formError">{error}</div>}
            <button className="button" disabled={status === "loading"} type="submit">
              {status === "loading" ? "Creating…" : "Create account"}
            </button>
          </form>
        )}
        <p className="authLinks">
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
