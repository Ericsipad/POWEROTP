import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Real SIP registration state per trunk id, parsed from `asterisk -rx
 * "pjsip show registrations"` — the same CLI check a session doing manual
 * troubleshooting already runs over SSH (see `docs/AS_BUILT.md`'s "Outbound
 * trunk pool" incident notes). This is the only source of truth for whether
 * a trunk actually has a live SIP registration; `TrunkPool`'s own health
 * tracking (`trunk-pool.ts`) is a separate, call-outcome-based signal.
 */
export type RegistrationState = "Registered" | "Rejected" | "Unregistered" | "Unknown";

export interface TrunkRegistrationStatus {
  id: string;
  registrationState: RegistrationState;
}

const KNOWN_STATES = new Set<RegistrationState>(["Registered", "Rejected", "Unregistered"]);

/**
 * Real captured output (Asterisk 20, this project's droplet):
 *
 * ```
 *  <Registration/ServerURI..............................>  <Auth....................>  <Status.......>
 * ==========================================================================================
 *
 *  trunk-1/sip:sanjose2.voip.ms                            trunk-1-auth                Registered        (exp. 1757s)
 *  trunk-2/sip:sanjose2.voip.ms                            trunk-2-auth                Rejected          (exp. 11906s ago)
 *
 * Objects found: 4
 * ```
 *
 * Columns are separated by 2+ spaces; the trunk id is the part of the first
 * column before its `/`. Lines that don't parse as a data row (header,
 * `===`, blank, `Objects found: N`) are silently skipped rather than
 * treated as an error — a CLI format change should degrade to "no status
 * reported" for that node, not crash the whole config-poll cycle.
 */
export function parsePjsipRegistrations(output: string): TrunkRegistrationStatus[] {
  const results: TrunkRegistrationStatus[] = [];
  for (const line of output.split("\n")) {
    const fields = line.trim().split(/\s{2,}/).filter(Boolean);
    if (fields.length < 3) continue;

    const id = fields[0]!.split("/")[0]!.trim();
    if (!id.startsWith("trunk-")) continue;

    const state = fields[2]!.trim();
    results.push({
      id,
      registrationState: KNOWN_STATES.has(state as RegistrationState)
        ? (state as RegistrationState)
        : "Unknown",
    });
  }
  return results;
}

/**
 * Runs the CLI check locally against this node's own Asterisk instance.
 * Never throws for a non-zero exit or malformed output — a status-reporting
 * failure must never block the trunk-config sync it's piggybacked on (see
 * `index.ts#syncOnce`); it just means this poll cycle reports no
 * registration status.
 */
export async function currentPjsipRegistrations(): Promise<TrunkRegistrationStatus[]> {
  try {
    const { stdout } = await run("asterisk", ["-rx", "pjsip show registrations"]);
    return parsePjsipRegistrations(stdout);
  } catch {
    return [];
  }
}
