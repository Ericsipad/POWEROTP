"use client";

import type { CustomerBalance, FinancialTransaction } from "@/lib/contracts";
import { useRef, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api-client";

/**
 * Admin-only lookup of any customer's balance/ledger for support — see
 * `docs/AS_BUILT.md`'s "Customer balance billing" section. Manual lookup
 * only, same convention as every other admin panel (no auto-polling).
 */
interface BillingLedgerPanelProps {
  csrfToken: string;
}

export function BillingLedgerPanel({ csrfToken }: BillingLedgerPanelProps) {
  const [userId, setUserId] = useState("");
  const [balance, setBalance] = useState<CustomerBalance>();
  const [transactions, setTransactions] = useState<FinancialTransaction[]>();
  const [status, setStatus] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustStatus, setAdjustStatus] = useState("");
  const adjustmentKey = useRef<string | undefined>(undefined);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId.trim()) return;
    setStatus("Loading…");
    const response = await apiFetch(
      `/v1/admin/billing/ledger?userId=${encodeURIComponent(userId.trim())}`,
      { cache: "no-store" },
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

  async function adjustBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountUsd = Number(adjustAmount);
    if (!userId.trim() || !amountUsd) return;
    const idempotencyKey = adjustmentKey.current ?? crypto.randomUUID();
    adjustmentKey.current = idempotencyKey;
    setAdjustStatus("Applying…");
    const response = await apiFetch("/v1/admin/billing/credit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ userId: userId.trim(), amountUsd, note: adjustNote.trim() || undefined }),
    });
    if (!response.ok) {
      setAdjustStatus("Adjustment failed.");
      return;
    }
    setAdjustStatus("Applied.");
    setAdjustAmount("");
    setAdjustNote("");
    adjustmentKey.current = undefined;
    await lookup({ preventDefault: () => {} } as FormEvent<HTMLFormElement>);
  }

  return (
    <article className="projectCard">
      <h2>Customer balance lookup</h2>
      <p>Enter a customer&apos;s user id to view their balance and recent ledger rows.</p>
      <form onSubmit={lookup}>
        <label className="field">
          User id
          <input
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              adjustmentKey.current = undefined;
            }}
            required
          />
        </label>
        <button className="button buttonSmall" type="submit">
          Look up
        </button>
      </form>
      {status && <p>{status}</p>}
      <h3>Manually credit/debit this user</h3>
      <p>
        Positive amount credits, negative debits. Use this for support cases (e.g. a customer
        blocked before top-ups/rates were configured) — there is no automated alternative.
      </p>
      <form className="formStack" onSubmit={adjustBalance}>
        <label className="field">
          Amount (USD, signed)
          <input
            type="number"
            step="0.01"
            value={adjustAmount}
            onChange={(event) => {
              setAdjustAmount(event.target.value);
              adjustmentKey.current = undefined;
            }}
            placeholder="e.g. 10 or -5"
            required
          />
        </label>
        <label className="field">
          Note (optional)
          <input
            value={adjustNote}
            onChange={(event) => {
              setAdjustNote(event.target.value);
              adjustmentKey.current = undefined;
            }}
          />
        </label>
        <button
          className="button buttonSmall"
          type="submit"
          disabled={!userId.trim() || adjustStatus === "Applying…"}
        >
          Apply adjustment
        </button>
        {adjustStatus && <p>{adjustStatus}</p>}
      </form>
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
