"use client";

import type { BillingTier, CallRateCard, EmailRate, PlanCharge, SmsRateCard } from "@powerotp/contracts";
import { useEffect, useState, type FormEvent } from "react";

interface BillingRatesPanelProps {
  csrfToken: string;
}

const jsonHeaders = { "content-type": "application/json" };
const tiers: BillingTier[] = ["tier1", "tier2", "tier3"];

/**
 * Admin CRUD for the per-country call/SMS rate charts and the per-tier
 * monthly/daily plan charge chart — see `docs/AS_BUILT.md`'s "Customer
 * balance billing" section. The actual numbers are gathered by an admin
 * from VoIP.ms's own published per-country/per-minute rates (and the
 * equivalent SMS rates); nothing here is fetched automatically.
 */
export function BillingRatesPanel({ csrfToken }: BillingRatesPanelProps) {
  const [callRates, setCallRates] = useState<CallRateCard[]>([]);
  const [smsRates, setSmsRates] = useState<SmsRateCard[]>([]);
  const [emailRate, setEmailRate] = useState<EmailRate | null>(null);
  const [plans, setPlans] = useState<PlanCharge[]>([]);
  const [status, setStatus] = useState("");

  const [country, setCountry] = useState("");
  const [callTiers, setCallTiers] = useState({ tier1: "", tier2: "", tier3: "" });
  const [smsCountry, setSmsCountry] = useState("");
  const [smsTiers, setSmsTiers] = useState({ tier1: "", tier2: "", tier3: "" });
  const [emailTiers, setEmailTiers] = useState({ tier1: "", tier2: "", tier3: "" });

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [callResponse, smsResponse, emailResponse, planResponse] = await Promise.all([
      fetch("/v1/admin/billing/call-rates", { credentials: "same-origin", cache: "no-store" }),
      fetch("/v1/admin/billing/sms-rates", { credentials: "same-origin", cache: "no-store" }),
      fetch("/v1/admin/billing/email-rate", { credentials: "same-origin", cache: "no-store" }),
      fetch("/v1/admin/billing/plan-charges", { credentials: "same-origin", cache: "no-store" }),
    ]);
    if (callResponse.ok) setCallRates((await callResponse.json()).rates);
    if (smsResponse.ok) setSmsRates((await smsResponse.json()).rates);
    if (emailResponse.ok) {
      const rate = (await emailResponse.json()).rate as EmailRate | null;
      setEmailRate(rate);
      if (rate) {
        setEmailTiers({
          tier1: String(rate.tier1PerEmailUsd),
          tier2: String(rate.tier2PerEmailUsd),
          tier3: String(rate.tier3PerEmailUsd),
        });
      }
    }
    if (planResponse.ok) setPlans((await planResponse.json()).plans);
  }

  async function saveCallRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/v1/admin/billing/call-rates", {
      method: "PUT",
      credentials: "same-origin",
      headers: { ...jsonHeaders, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        countryCode: country.trim().toUpperCase(),
        tier1PerMinuteUsd: Number(callTiers.tier1) || 0,
        tier2PerMinuteUsd: Number(callTiers.tier2) || 0,
        tier3PerMinuteUsd: Number(callTiers.tier3) || 0,
      }),
    });
    setStatus(response.ok ? "Call rate saved." : "Call rate rejected — check the country code.");
    if (response.ok) {
      setCountry("");
      setCallTiers({ tier1: "", tier2: "", tier3: "" });
      await refresh();
    }
  }

  async function saveSmsRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/v1/admin/billing/sms-rates", {
      method: "PUT",
      credentials: "same-origin",
      headers: { ...jsonHeaders, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        countryCode: smsCountry.trim().toUpperCase(),
        tier1PerMessageUsd: Number(smsTiers.tier1) || 0,
        tier2PerMessageUsd: Number(smsTiers.tier2) || 0,
        tier3PerMessageUsd: Number(smsTiers.tier3) || 0,
      }),
    });
    setStatus(response.ok ? "SMS rate saved." : "SMS rate rejected — check the country code.");
    if (response.ok) {
      setSmsCountry("");
      setSmsTiers({ tier1: "", tier2: "", tier3: "" });
      await refresh();
    }
  }

  async function saveEmailRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/v1/admin/billing/email-rate", {
      method: "PUT",
      credentials: "same-origin",
      headers: { ...jsonHeaders, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        tier1PerEmailUsd: Number(emailTiers.tier1) || 0,
        tier2PerEmailUsd: Number(emailTiers.tier2) || 0,
        tier3PerEmailUsd: Number(emailTiers.tier3) || 0,
      }),
    });
    setStatus(response.ok ? "Email rate saved." : "Email rate rejected.");
    if (response.ok) await refresh();
  }

  async function savePlanCharge(tier: BillingTier, monthlyDisplayUsd: string, dailyChargedUsd: string) {
    const response = await fetch("/v1/admin/billing/plan-charges", {
      method: "PUT",
      credentials: "same-origin",
      headers: { ...jsonHeaders, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        tier,
        monthlyDisplayUsd: Number(monthlyDisplayUsd) || 0,
        dailyChargedUsd: Number(dailyChargedUsd) || 0,
      }),
    });
    setStatus(response.ok ? `${tier} plan charge saved.` : "Plan charge rejected.");
    if (response.ok) await refresh();
  }

  return (
    <>
      <article className="projectCard">
        <h2>Call rate chart (USD/minute)</h2>
        <p>
          Gathered from VoIP.ms&apos;s own published per-country per-minute rates. Tier3
          (highest balance) should carry the cheapest rate, tier1 the most expensive.
        </p>
        <form onSubmit={saveCallRate}>
          <label className="field">
            Country code (ISO alpha-2, e.g. US)
            <input
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              maxLength={2}
              required
            />
          </label>
          {tiers.map((tier) => (
            <label className="field" key={tier}>
              {`${tier} $/minute`}
              <input
                type="number"
                step="0.0001"
                min="0"
                value={callTiers[tier]}
                onChange={(event) => setCallTiers({ ...callTiers, [tier]: event.target.value })}
                required
              />
            </label>
          ))}
          <button className="button buttonSmall" type="submit">
            Save call rate
          </button>
        </form>
        <table className="opsTable">
          <thead>
            <tr>
              <th>Country</th>
              <th>Tier1</th>
              <th>Tier2</th>
              <th>Tier3</th>
            </tr>
          </thead>
          <tbody>
            {callRates.length === 0 && (
              <tr>
                <td colSpan={4}>No call rates entered yet.</td>
              </tr>
            )}
            {callRates.map((rate) => (
              <tr key={rate.countryCode}>
                <td>{rate.countryCode}</td>
                <td>{rate.tier1PerMinuteUsd}</td>
                <td>{rate.tier2PerMinuteUsd}</td>
                <td>{rate.tier3PerMinuteUsd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <article className="projectCard">
        <h2>SMS rate chart (USD/message)</h2>
        <p>Gathered from VoIP.ms&apos;s own published per-country SMS rates.</p>
        <form onSubmit={saveSmsRate}>
          <label className="field">
            Country code (ISO alpha-2, e.g. US)
            <input
              value={smsCountry}
              onChange={(event) => setSmsCountry(event.target.value)}
              maxLength={2}
              required
            />
          </label>
          {tiers.map((tier) => (
            <label className="field" key={tier}>
              {`${tier} $/message`}
              <input
                type="number"
                step="0.0001"
                min="0"
                value={smsTiers[tier]}
                onChange={(event) => setSmsTiers({ ...smsTiers, [tier]: event.target.value })}
                required
              />
            </label>
          ))}
          <button className="button buttonSmall" type="submit">
            Save SMS rate
          </button>
        </form>
        <table className="opsTable">
          <thead>
            <tr>
              <th>Country</th>
              <th>Tier1</th>
              <th>Tier2</th>
              <th>Tier3</th>
            </tr>
          </thead>
          <tbody>
            {smsRates.length === 0 && (
              <tr>
                <td colSpan={4}>No SMS rates entered yet.</td>
              </tr>
            )}
            {smsRates.map((rate) => (
              <tr key={rate.countryCode}>
                <td>{rate.countryCode}</td>
                <td>{rate.tier1PerMessageUsd}</td>
                <td>{rate.tier2PerMessageUsd}</td>
                <td>{rate.tier3PerMessageUsd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <article className="projectCard">
        <h2>Email rate (USD/email, flat &mdash; no country)</h2>
        <p>
          Brevo&apos;s per-email sending cost isn&apos;t country-dependent, so
          <code>email_code</code> has a single global rate per tier instead of a
          per-country chart.
        </p>
        <form onSubmit={saveEmailRate}>
          {tiers.map((tier) => (
            <label className="field" key={tier}>
              {`${tier} $/email`}
              <input
                type="number"
                step="0.0001"
                min="0"
                value={emailTiers[tier]}
                onChange={(event) => setEmailTiers({ ...emailTiers, [tier]: event.target.value })}
                required
              />
            </label>
          ))}
          <button className="button buttonSmall" type="submit">
            {emailRate ? "Update email rate" : "Save email rate"}
          </button>
        </form>
        {emailRate && (
          <p>
            Current: tier1 ${emailRate.tier1PerEmailUsd}, tier2 ${emailRate.tier2PerEmailUsd}, tier3 $
            {emailRate.tier3PerEmailUsd}
          </p>
        )}
      </article>

      <article className="projectCard">
        <h2>Plan charge chart (shown monthly, charged daily)</h2>
        <p>
          Both values are entered independently &mdash; the daily amount is not
          automatically derived from the monthly display amount.
        </p>
        <table className="opsTable">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Monthly display ($)</th>
              <th>Daily charged ($)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => {
              const existing = plans.find((plan) => plan.tier === tier);
              return (
                <PlanChargeRow
                  key={tier}
                  tier={tier}
                  existing={existing}
                  onSave={savePlanCharge}
                />
              );
            })}
          </tbody>
        </table>
      </article>
      {status && <p>{status}</p>}
    </>
  );
}

function PlanChargeRow({
  tier,
  existing,
  onSave,
}: {
  tier: BillingTier;
  existing?: PlanCharge;
  onSave: (tier: BillingTier, monthlyDisplayUsd: string, dailyChargedUsd: string) => void;
}) {
  const [monthly, setMonthly] = useState(existing ? String(existing.monthlyDisplayUsd) : "");
  const [daily, setDaily] = useState(existing ? String(existing.dailyChargedUsd) : "");

  return (
    <tr>
      <td>{tier}</td>
      <td>
        <input
          type="number"
          step="0.01"
          min="0"
          value={monthly}
          onChange={(event) => setMonthly(event.target.value)}
        />
      </td>
      <td>
        <input
          type="number"
          step="0.0001"
          min="0"
          value={daily}
          onChange={(event) => setDaily(event.target.value)}
        />
      </td>
      <td>
        <button
          className="button buttonSmall buttonGhost"
          type="button"
          onClick={() => onSave(tier, monthly, daily)}
        >
          Save
        </button>
      </td>
    </tr>
  );
}
