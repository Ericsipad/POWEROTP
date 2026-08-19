"use client";

import type { AccountingAdminConfig } from "@/lib/contracts";
import { useState } from "react";

interface Props {
  config: AccountingAdminConfig;
  save(adSystemId: string, serviceDate: string, grossPayoutUsd: string): Promise<void>;
}

export function AdPayoutCalendar({ config, save }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <article className="projectCard">
      <h2>Ad payout calendar</h2>
      <p>
        Enter the gross payout pool for each ad system and complete UTC day. Unsettled
        entries from any of the latest 10 days are picked up by the daily worker.
      </p>
      {config.adSystems.length === 0 ? (
        <p>Add an ad system before entering payouts.</p>
      ) : (
        <table className="opsTable">
          <thead>
            <tr>
              <th>UTC day</th>
              {config.adSystems.map((system) => <th key={system.id}>{system.displayName}</th>)}
            </tr>
          </thead>
          <tbody>
            {config.serviceDates.map((serviceDate) => (
              <tr key={serviceDate}>
                <td>{serviceDate}</td>
                {config.adSystems.map((system) => {
                  const key = `${system.id}:${serviceDate}`;
                  const payout = config.payouts.find(
                    (row) => row.adSystemId === system.id && row.serviceDate === serviceDate,
                  );
                  return (
                    <td key={key}>
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        aria-label={`${system.displayName} payout for ${serviceDate}`}
                        value={drafts[key] ?? payout?.grossPayoutUsd ?? ""}
                        disabled={payout?.status === "settled"}
                        onChange={(event) => setDrafts({ ...drafts, [key]: event.target.value })}
                      />
                      <button
                        className="button buttonSmall buttonGhost"
                        type="button"
                        disabled={payout?.status === "settled" || !(drafts[key] ?? payout?.grossPayoutUsd)}
                        onClick={() => save(system.id, serviceDate, drafts[key] ?? payout?.grossPayoutUsd ?? "")}
                      >
                        {payout?.status === "settled" ? "Settled" : "Save"}
                      </button>
                      {payout && (
                        <small>
                          {payout.status}
                          {payout.totalFilledSlots === undefined ? "" : ` · ${payout.totalFilledSlots} filled`}
                          {payout.failureReason ? ` · ${payout.failureReason}` : ""}
                        </small>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
