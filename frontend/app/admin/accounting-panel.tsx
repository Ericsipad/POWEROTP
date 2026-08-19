"use client";

import type { AccountingAdminConfig, BillingThresholdRule } from "@/lib/contracts";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api-client";

import { AdPayoutCalendar } from "./ad-payout-calendar";

interface Props {
  csrfToken: string;
}

const jsonHeaders = { "content-type": "application/json" };
const emptyCommissions = {
  signupChargePercent: "",
  signinChargePercent: "",
  adDepositPercent: "",
  recurringChargePercent: "",
};

export function AccountingPanel({ csrfToken }: Props) {
  const [config, setConfig] = useState<AccountingAdminConfig>();
  const [status, setStatus] = useState("");
  const [commissions, setCommissions] = useState(emptyCommissions);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const response = await apiFetch("/v1/admin/billing/accounting", { cache: "no-store" });
    if (!response.ok) return;
    const result = (await response.json()) as AccountingAdminConfig;
    setConfig(result);
    if (result.commissions) {
      setCommissions({
        signupChargePercent: String(result.commissions.signupChargePercent),
        signinChargePercent: String(result.commissions.signinChargePercent),
        adDepositPercent: String(result.commissions.adDepositPercent),
        recurringChargePercent: String(result.commissions.recurringChargePercent),
      });
    }
  }

  async function request(path: string, method: string, body: unknown) {
    const response = await apiFetch(path, {
      method,
      headers: { ...jsonHeaders, "x-csrf-token": csrfToken },
      body: JSON.stringify(body),
    });
    setStatus(response.ok ? "Accounting configuration saved." : "Accounting configuration was rejected.");
    if (response.ok) await refresh();
  }

  async function addAdSystem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request("/v1/admin/billing/ad-systems", "PUT", {
      id: String(form.get("id")),
      displayName: String(form.get("displayName")),
      active: true,
    });
    event.currentTarget.reset();
  }

  async function addThreshold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request("/v1/admin/billing/thresholds", "POST", {
      eventType: form.get("eventType"),
      thresholdCount: Number(form.get("thresholdCount")),
      tier1ChargeUsd: Number(form.get("tier1ChargeUsd")),
      tier2ChargeUsd: Number(form.get("tier2ChargeUsd")),
      tier3ChargeUsd: Number(form.get("tier3ChargeUsd")),
      active: true,
    });
    event.currentTarget.reset();
  }

  async function setThresholdActive(rule: BillingThresholdRule, active: boolean) {
    await request(`/v1/admin/billing/thresholds/${rule.id}`, "PATCH", {
      tier1ChargeUsd: rule.tier1ChargeUsd,
      tier2ChargeUsd: rule.tier2ChargeUsd,
      tier3ChargeUsd: rule.tier3ChargeUsd,
      active,
    });
  }

  async function saveCommissions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await request("/v1/admin/billing/referral-commissions", "PUT", {
      signupChargePercent: Number(commissions.signupChargePercent),
      signinChargePercent: Number(commissions.signinChargePercent),
      adDepositPercent: Number(commissions.adDepositPercent),
      recurringChargePercent: Number(commissions.recurringChargePercent),
    });
  }

  if (!config) return <article className="projectCard"><p>Loading accounting configuration…</p></article>;

  return (
    <>
      <article className="projectCard">
        <h2>Ad systems</h2>
        <form className="formStack" onSubmit={addAdSystem}>
          <label className="field">System ID<input name="id" required pattern="[a-z][a-z0-9_-]{1,63}" /></label>
          <label className="field">Display name<input name="displayName" required maxLength={100} /></label>
          <button className="button buttonSmall" type="submit">Add ad system</button>
        </form>
        <p>{config.adSystems.map((system) => `${system.displayName} (${system.id})`).join(", ") || "None configured."}</p>
      </article>

      <AdPayoutCalendar
        config={config}
        save={(adSystemId, serviceDate, grossPayoutUsd) =>
          request("/v1/admin/billing/ad-payouts", "PUT", { adSystemId, serviceDate, grossPayoutUsd })}
      />

      <article className="projectCard">
        <h2>Signup and signin thresholds</h2>
        <form className="formStack" onSubmit={addThreshold}>
          <label className="field">
            Event
            <select name="eventType"><option value="signup">Signup</option><option value="signin">Signin</option></select>
          </label>
          <label className="field">Rolling-30-day threshold<input name="thresholdCount" type="number" min="1" required /></label>
          {(["tier1", "tier2", "tier3"] as const).map((tier) => (
            <label className="field" key={tier}>
              {tier} charge USD
              <input name={`${tier}ChargeUsd`} type="number" min="0" step="0.000001" required />
            </label>
          ))}
          <button className="button buttonSmall" type="submit">Add threshold</button>
        </form>
        <table className="opsTable">
          <thead><tr><th>Event</th><th>Threshold</th><th>Tier 1</th><th>Tier 2</th><th>Tier 3</th><th>Status</th></tr></thead>
          <tbody>
            {config.thresholds.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.eventType}</td><td>{rule.thresholdCount}</td>
                <td>${rule.tier1ChargeUsd}</td><td>${rule.tier2ChargeUsd}</td><td>${rule.tier3ChargeUsd}</td>
                <td><button className="button buttonSmall buttonGhost" type="button" onClick={() => setThresholdActive(rule, !rule.active)}>{rule.active ? "Deactivate" : "Activate"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <article className="projectCard">
        <h2>Referral commission percentages</h2>
        <form className="formStack" onSubmit={saveCommissions}>
          {(Object.keys(emptyCommissions) as Array<keyof typeof emptyCommissions>).map((field) => (
            <label className="field" key={field}>
              {field}
              <input type="number" min="0" max="100" step="0.0001" required value={commissions[field]} onChange={(event) => setCommissions({ ...commissions, [field]: event.target.value })} />
            </label>
          ))}
          <button className="button buttonSmall" type="submit">Save commissions</button>
        </form>
      </article>
      {status && <p>{status}</p>}
    </>
  );
}
