import type { VerificationType } from "@powerotp/contracts";

import type { ProductionConfig } from "./config.js";

export type VoiceVerificationType = Exclude<VerificationType, "sms_code">;

export interface OutboundTrunk {
  id: string;
  url: string;
  user: string;
  pass: string;
}

type OutboundConfig = Pick<
  ProductionConfig,
  | "TRUNK1_URL" | "TRUNK1_USER" | "TRUNK1_PASS" | "TRUNK1_DID"
  | "TRUNK2_URL" | "TRUNK2_USER" | "TRUNK2_PASS" | "TRUNK2_DID"
  | "TRUNK3_URL" | "TRUNK3_USER" | "TRUNK3_PASS" | "TRUNK3_DID"
  | "TRUNK4_URL" | "TRUNK4_USER" | "TRUNK4_PASS" | "TRUNK4_DID"
  | "TRUNK5_URL" | "TRUNK5_USER" | "TRUNK5_PASS" | "TRUNK5_DID"
  | "TRUNK6_URL" | "TRUNK6_USER" | "TRUNK6_PASS" | "TRUNK6_DID"
>;

const trunkNumbers = [1, 2, 3, 4, 5, 6] as const;

function keysFor(n: number) {
  return {
    url: `TRUNK${n}_URL` as keyof OutboundConfig,
    user: `TRUNK${n}_USER` as keyof OutboundConfig,
    pass: `TRUNK${n}_PASS` as keyof OutboundConfig,
    did: `TRUNK${n}_DID` as keyof OutboundConfig,
  };
}

/**
 * Every fully-configured trunk in the pool, in numeric order, each tagged
 * with a stable id (`trunk-1`, `trunk-2`, ...). Any of the three voice
 * verification methods (`call_reachability`, `voice_code`,
 * `voice_challenge`) can be served by any trunk here — selection and
 * rotation/failover happen on the telephony-agent side (see
 * `apps/telephony-agent/src/trunk-pool.ts`), not here. A `TRUNKn` whose
 * url/user/pass aren't all present is skipped entirely (same "all three
 * or none" convention every other optional trunk config has always used).
 */
export function allOutboundTrunks(config: OutboundConfig): OutboundTrunk[] {
  const trunks: OutboundTrunk[] = [];
  for (const n of trunkNumbers) {
    const keys = keysFor(n);
    const url = config[keys.url];
    const user = config[keys.user];
    const pass = config[keys.pass];
    if (!url || !user || !pass) continue;
    trunks.push({ id: `trunk-${n}`, url, user, pass });
  }
  return trunks;
}

/**
 * Whether at least one trunk is configured at all. Used to gate voice
 * method dispatch (`apps/api/src/transport.ts`) — since any trunk can
 * serve any voice type now, dispatch no longer checks for a
 * method-specific trunk, only that the pool isn't empty.
 */
export function hasAnyOutboundTrunk(config: OutboundConfig): boolean {
  return allOutboundTrunks(config).length > 0;
}

/**
 * Every `TRUNKn_DID` that is set, in numeric order — independent of
 * whether that trunk's url/user/pass are also configured, since a DID
 * is just a phone number and doesn't require SIP credentials to be
 * usable for sending SMS. This is the only place `TRUNKn_DID` is read:
 * `apps/api/src/sms.ts` uses it as the pool of numbers `sms_code` can
 * send from, instead of one hardcoded `VOIPMS_SMS_DID`. Deliberately
 * separate from `allOutboundTrunks` (which never includes a DID) —
 * telephony nodes only ever need SIP credentials, never the DID itself.
 */
export function allTrunkDids(config: OutboundConfig): string[] {
  const dids: string[] = [];
  for (const n of trunkNumbers) {
    const did = config[keysFor(n).did];
    if (did) dids.push(did);
  }
  return dids;
}
