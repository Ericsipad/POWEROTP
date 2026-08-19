"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Props {
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}

export function ReferralPanel({ authenticatedFetch }: Props) {
  const [code, setCode] = useState<string | null>();
  const [status, setStatus] = useState("");

  useEffect(() => {
    void authenticatedFetch("/v1/referrals").then(async (response) => {
      if (response.ok) setCode((await response.json()).referralCode);
    });
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requested = String(new FormData(event.currentTarget).get("code") ?? "").trim().toLowerCase();
    const response = await authenticatedFetch("/v1/referrals", {
      method: "POST",
      body: JSON.stringify({ code: requested }),
    });
    if (!response.ok) {
      setStatus("That referral name is unavailable.");
      return;
    }
    setCode((await response.json()).referralCode);
    setStatus("Referral link created.");
  }

  return (
    <article className="projectCard">
      <h2>Your referral link</h2>
      {code ? (
        <p><strong>{`${window.location.origin}/${code}`}</strong></p>
      ) : (
        <form className="formStack" onSubmit={create}>
          <label className="field">Referral name<input name="code" minLength={3} maxLength={40} required /></label>
          <button className="button buttonSmall" type="submit">Create referral link</button>
        </form>
      )}
      {status && <p>{status}</p>}
    </article>
  );
}
