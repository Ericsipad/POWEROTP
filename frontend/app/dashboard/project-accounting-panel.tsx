"use client";

import type { ProjectAccounting } from "@/lib/contracts";
import { useEffect, useState, type FormEvent } from "react";

interface Props {
  projectId: string;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}

export function ProjectAccountingPanel({ projectId, authenticatedFetch }: Props) {
  const [accounting, setAccounting] = useState<ProjectAccounting>();
  const [status, setStatus] = useState("");

  useEffect(() => {
    void refresh();
  }, [projectId]);

  async function refresh() {
    const response = await authenticatedFetch(`/v1/projects/${projectId}/accounting`);
    if (response.ok) setAccounting((await response.json()) as ProjectAccounting);
  }

  async function saveReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("referralCode") ?? "").trim();
    const response = await authenticatedFetch(`/v1/projects/${projectId}/referral`, {
      method: "PUT",
      body: JSON.stringify({ code: code || null }),
    });
    setStatus(response.ok ? "Project referral saved." : "Referral code was rejected.");
    if (response.ok) await refresh();
  }

  if (!accounting) return <p>Loading project accounting…</p>;
  return (
    <section>
      <h3>Project accounting</h3>
      <div className="statsGrid">
        <div className="stat"><strong>{accounting.signupCount30Days}</strong><span>Signups · 30 days</span></div>
        <div className="stat"><strong>{accounting.signinCount30Days}</strong><span>Signins · 30 days</span></div>
      </div>
      <form className="formStack" onSubmit={saveReferral}>
        <label className="field">
          Project referral code
          <input name="referralCode" defaultValue={accounting.referralCode ?? ""} maxLength={40} />
        </label>
        <button className="button buttonSmall buttonGhost" type="submit">Save referral</button>
      </form>
      {status && <p>{status}</p>}
      <table className="opsTable">
        <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Closing balance</th></tr></thead>
        <tbody>
          {accounting.transactions.length === 0 && <tr><td colSpan={4}>No project transactions yet.</td></tr>}
          {accounting.transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>{new Date(transaction.createdAt).toLocaleString()}</td>
              <td>{transaction.type}</td>
              <td>${transaction.amountUsd.toFixed(6)}</td>
              <td>${transaction.closingBalanceUsd.toFixed(6)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
