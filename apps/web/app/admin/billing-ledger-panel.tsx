"use client";

import type { CustomerBalance, FinancialTransaction } from "@powerotp/contracts";
import { useState, type FormEvent } from "react";

/**
 * Admin-only lookup of any customer's balance/ledger for support — see
 * `docs/AS_BUILT.md`'s "Customer balance billing" section. Manual lookup
 * only, same convention as every other admin panel (no auto-polling).
 */
export function BillingLedgerPanel() {
  const [userId, setUserId] = useState("");
  const [balance, setBalance] = useState<CustomerBalance>();
  const [transactions, setTransactions] = useState<FinancialTransaction[]>();
  const [status, setStatus] = useState("");

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId.trim()) return;
    setStatus("Loading…");
    const response = await fetch(
      `/v1/admin/billing/ledger?userId=${encodeURIComponent(userId.trim())}`,
      { credentials: "same-origin", cache: "no-store" },
    );
    if (!response.ok) {
      setStatus("Lookup failed.");
      setBalance(undefined);
      setTransactions(undefined);
      return;
    }
    const result = (await response.json()) as {
      balance: CustomerBalance;
      transactions: FinancialTransaction[];
    };
    setBalance(result.balance);
    setTransactions(result.transactions);
    setStatus("");
  }

  return (
    <article className="projectCard">
      <h2>Customer balance lookup</h2>
      <p>Enter a customer&apos;s user id to view their balance and recent ledger rows.</p>
      <form onSubmit={lookup}>
        <label className="field">
          User id
          <input value={userId} onChange={(event) => setUserId(event.target.value)} required />
        </label>
        <button className="button buttonSmall" type="submit">
          Look up
        </button>
      </form>
      {status && <p>{status}</p>}
      {balance && (
        <div className="statsGrid">
          <div className="stat">
            <strong>${balance.balanceUsd.toFixed(2)}</strong>
            <span>Balance</span>
          </div>
          <div className="stat">
            <strong>{balance.tier}</strong>
            <span>Tier</span>
          </div>
        </div>
      )}
      {transactions && (
        <table className="opsTable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Project</th>
              <th>Country</th>
              <th>Amount</th>
              <th>Closing balance</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr>
                <td colSpan={6}>No ledger rows yet.</td>
              </tr>
            )}
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td>{new Date(transaction.createdAt).toLocaleString()}</td>
                <td>{transaction.type}</td>
                <td>{transaction.projectId ?? "—"}</td>
                <td>{transaction.country ?? "—"}</td>
                <td>${transaction.amountUsd.toFixed(4)}</td>
                <td>${transaction.closingBalanceUsd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
