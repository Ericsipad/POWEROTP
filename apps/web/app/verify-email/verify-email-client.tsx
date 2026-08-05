"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function VerifyEmailClient() {
  const [status, setStatus] = useState<"checking" | "verified" | "failed">(
    "checking",
  );

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (!token) {
      setStatus("failed");
      return;
    }
    void fetch("/v1/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).then((response) => setStatus(response.ok ? "verified" : "failed"));
  }, []);

  return (
    <section className="authCard">
      <Link className="brand" href="/">
        <span className="brandMark">P</span> POWEROTP
      </Link>
      <h1>Email verification</h1>
      {status === "checking" && <p>Verifying your secure link…</p>}
      {status === "verified" && (
        <>
          <p className="formSuccess">Your email is verified.</p>
          <Link className="button" href="/login">
            Continue to login
          </Link>
        </>
      )}
      {status === "failed" && (
        <p className="formError">This verification link is invalid or expired.</p>
      )}
    </section>
  );
}
