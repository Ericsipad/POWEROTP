import type { VerificationType } from "@powerotp/contracts";

import type { ProductionConfig } from "./config.js";

export type VoiceVerificationType = Exclude<VerificationType, "sms_code">;

export interface OutboundTrunk {
  url: string;
  user: string;
  pass: string;
}

type OutboundConfig = Pick<
  ProductionConfig,
  | "OUTBOUND1_URL"
  | "OUTBOUND1_USER"
  | "OUTBOUND1_PASS"
  | "OUTBOUND2_URL"
  | "OUTBOUND2_USER"
  | "OUTBOUND2_PASS"
  | "OUTBOUND3_URL"
  | "OUTBOUND3_USER"
  | "OUTBOUND3_PASS"
>;

/**
 * Each verification method dials out on its own dedicated VoIP.ms trunk,
 * never a shared one, so a per-method spend limit, suspension, or leaked
 * credential cannot be used to abuse another method. This mapping is the
 * single source of truth consumed once Phase 4 distributes trunk
 * configuration to telephony nodes.
 */
const trunkKeysByType: Record<
  VoiceVerificationType,
  { url: keyof OutboundConfig; user: keyof OutboundConfig; pass: keyof OutboundConfig }
> = {
  call_reachability: { url: "OUTBOUND1_URL", user: "OUTBOUND1_USER", pass: "OUTBOUND1_PASS" },
  voice_code: { url: "OUTBOUND2_URL", user: "OUTBOUND2_USER", pass: "OUTBOUND2_PASS" },
  voice_challenge: { url: "OUTBOUND3_URL", user: "OUTBOUND3_USER", pass: "OUTBOUND3_PASS" },
};

export function outboundTrunkFor(
  config: OutboundConfig,
  type: VoiceVerificationType,
): OutboundTrunk | undefined {
  const keys = trunkKeysByType[type];
  const url = config[keys.url];
  const user = config[keys.user];
  const pass = config[keys.pass];
  if (!url || !user || !pass) return undefined;
  return { url, user, pass };
}
