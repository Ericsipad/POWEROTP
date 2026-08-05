"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/v1/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        totpCode: form.get("totpCode"),
      }),
    });

    if (!response.ok) {
      setError("Invalid administrator credentials or authenticator code.");
      setLoading(false);
      return;
    }
    router.replace("/admin");
  }

  return (
    <main className="authPage">
      <section className="authCard">
        <Link className="brand" href="/">
          <span className="brandMark">P</span> POWEROTP
        </Link>
        <p className="adminNotice">Restricted platform administration</p>
        <h1>Admin login</h1>
        <form className="formStack" onSubmit={submit}>
          <label className="field">
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label className="field">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            Authenticator code
            <input
              name="totpCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
            />
          </label>
          {error && <div className="formError">{error}</div>}
          <button className="button" disabled={loading} type="submit">
            {loading ? "Verifying…" : "Sign in securely"}
          </button>
        </form>
      </section>
    </main>
  );
}
