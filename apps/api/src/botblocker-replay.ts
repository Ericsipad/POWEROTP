import {
  consumeBotBlockerNonce,
  type BotBlockerNonceConsumptionResult,
  type BotBlockerNonceScope,
} from "@powerotp/botblocker-signing";
import type { Redis } from "ioredis";

/**
 * Production adapter over the API's existing authenticated Valkey client.
 * `consumeBotBlockerNonce` issues one atomic SET NX PX operation and returns
 * storage errors as fail-closed rejections.
 */
export function consumeBotBlockerNonceInValkey(
  valkey: Redis,
  options: {
    scope: BotBlockerNonceScope;
    nonce: string;
    expiresAt: number;
    now?: number;
    clockSkewMs?: number;
  },
): Promise<BotBlockerNonceConsumptionResult> {
  return consumeBotBlockerNonce(valkey, options);
}
