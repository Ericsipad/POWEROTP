"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api-client";

export default function AdminLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await apiFetch("/v1/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });

    if (!response.ok) {
      setError("Invalid administrator credentials.");
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
          {error && <div className="formError">{error}</div>}
          <button className="button" disabled={loading} type="submit">
            {loading ? "Verifying…" : "Sign in securely"}
          </button>
        </form>
      </section>
    </main>
  );
}
