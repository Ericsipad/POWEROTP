"use client";

import type { CustomerBalance, FinancialTransaction } from "@/lib/contracts";
import { useEffect, useState } from "react";

interface BillingPanelProps {
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
  onBalanceChange?(balance: CustomerBalance): void;
}

const topupAmounts = [5, 25, 50, 100] as const;

/**
 * A customer's own current balance/tier, recent ledger, and Stripe
 * fixed-amount top-up buttons — see `docs/AS_BUILT.md`'s "Customer balance
 * billing" section.
 */
export function BillingPanel({
  authenticatedFetch,
  onBalanceChange,
}: BillingPanelProps) {
  const [balance, setBalance] = useState<CustomerBalance>();
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void refresh();
    // Polls while the dashboard is open so a Stripe-webhook-applied top-up
    // credit (which lands asynchronously, slightly after the customer is
    // redirected back — see `frontend/app/top-banner.tsx`) shows up without
    // a manual page refresh.
    const interval = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(interval);
  }, []);

  async function refresh() {
    const [balanceResponse, ledgerResponse] = await Promise.all([
      authenticatedFetch("/v1/billing/balance"),
      authenticatedFetch("/v1/billing/ledger"),
    ]);
    if (balanceResponse.ok) {
      const nextBalance = (await balanceResponse.json()).balance as CustomerBalance;
      setBalance(nextBalance);
      onBalanceChange?.(nextBalance);
    }
    if (ledgerResponse.ok) setTransactions((await ledgerResponse.json()).transactions);
  }

  async function topUp(amountUsd: number) {
    setStatus("Redirecting to Stripe…");
    const response = await authenticatedFetch("/v1/billing/topups", {
      method: "POST",
      body: JSON.stringify({ amountUsd }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      setStatus(
        body?.error === "billing_not_configured"
          ? "Top-ups are not available yet."
          : "Could not start checkout.",
      );
      return;
    }
    const { checkoutUrl } = (await response.json()) as { checkoutUrl: string };
    window.location.href = checkoutUrl;
  }

  return (
    <article className="projectCard">
      <h2>Account balance</h2>
      {balance && (
        <div className="statsGrid">
          <div className="stat">
            <strong>${balance.balanceUsd.toFixed(2)}</strong>
            <span>Balance</span>
          </div>
          <div className="stat">
            <strong>{balance.tier}</strong>
            <span>Pricing tier</span>
          </div>
        </div>
      )}
      <div className="projectActions">
        {topupAmounts.map((amount) => (
          <button
            className="button buttonSmall buttonGhost"
            type="button"
            key={amount}
            onClick={() => topUp(amount)}
          >
            {`Add $${amount}`}
          </button>
        ))}
      </div>
      {status && <p>{status}</p>}
      <table className="opsTable">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Closing balance</th>
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 && (
            <tr>
              <td colSpan={4}>No transactions yet.</td>
            </tr>
          )}
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>{new Date(transaction.createdAt).toLocaleString()}</td>
              <td>{transaction.type}</td>
              <td>${transaction.amountUsd.toFixed(4)}</td>
              <td>${transaction.closingBalanceUsd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
