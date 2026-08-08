import type { VerificationState, VerificationType } from "@powerotp/contracts";

import type { ProductionConfig } from "./config.js";
import { hasAnyOutboundTrunk } from "./outbound-trunks.js";
import { createVoipMsSmsService, SmsProviderError, type SmsService } from "./sms.js";

export interface TransportContext {
  interactionId: string;
  type: VerificationType;
  targetNumber: string;
  /** Present only for code-delivery transports; never log this context. */
  code?: string;
}

/**
 * Bound to one interaction. `advance` performs the shared, atomic state
 * transition (writes the event, updates counters, enqueues the callback) so
 * every transport drives the same durable machinery instead of each
 * implementing its own persistence.
 */
export interface TransportHandle {
  advance(
    state: VerificationState,
    reasonCode?: string,
    meta?: { smsDid?: string },
  ): Promise<boolean>;
}

export interface VerificationTransport {
  dispatch(context: TransportContext, handle: TransportHandle): Promise<void>;
}

/**
 * Registered for every verification type in production until the
 * corresponding telephony/SMS phase (4, 5, or 6) provides a real transport.
 * It never contacts any external system; it simply reports the method as
 * not yet available. This keeps Phase 3 free of mocked call/SMS behavior in
 * the deployed application while the durable state machine, queue,
 * callbacks, and tokens are fully exercised by tests using the fake
 * transport in `test-support/`.
 */
export const unavailableTransport: VerificationTransport = {
  async dispatch(_context, handle) {
    await handle.advance("failed", "method_not_available");
  },
};

export type TransportRegistry = Record<VerificationType, VerificationTransport>;

/**
 * Hands the interaction to whichever telephony node claims it next
 * (`GET /v1/nodes/jobs/next`, see `apps/api/src/node-service.ts` and the
 * route under `apps/web/app/v1/nodes/jobs`). This process never talks to
 * Asterisk/ARI directly — only a droplet's `apps/telephony-agent` does,
 * over localhost-only ARI — so all this transport does is confirm at
 * least one trunk exists in the pool at all (still `unavailableTransport`
 * otherwise, unchanged behavior from before) and advance to `dispatching`,
 * which is the signal a node polls for. Any configured trunk can serve
 * any of the three voice methods now, so gating is no longer type-specific
 * (see `apps/telephony-agent/src/trunk-pool.ts` for how a node actually
 * picks a trunk per call).
 */
function createNodeDispatchTransport(
  config: Pick<
    ProductionConfig,
    "TRUNK1_URL" | "TRUNK1_USER" | "TRUNK1_PASS" |
    "TRUNK2_URL" | "TRUNK2_USER" | "TRUNK2_PASS" |
    "TRUNK3_URL" | "TRUNK3_USER" | "TRUNK3_PASS" |
    "TRUNK4_URL" | "TRUNK4_USER" | "TRUNK4_PASS" |
    "TRUNK5_URL" | "TRUNK5_USER" | "TRUNK5_PASS" |
    "TRUNK6_URL" | "TRUNK6_USER" | "TRUNK6_PASS"
  >,
): VerificationTransport {
  return {
    async dispatch(context, handle) {
      if (!hasAnyOutboundTrunk(config)) {
        await handle.advance("failed", "method_not_available");
        return;
      }
      await handle.advance("dispatching", "queued_for_node");
    },
  };
}

export function createSmsCodeTransport(
  config: ProductionConfig,
  sms: SmsService | undefined = createVoipMsSmsService(config),
): VerificationTransport {
  if (!sms) return unavailableTransport;

  return {
    async dispatch(context, handle) {
      // Only the worker that atomically moved queued -> dispatching may
      // contact the provider. A BullMQ retry after an ambiguous failure
      // must not send the same verification code a second time.
      const claimed = await handle.advance("dispatching", "sending_to_provider");
      if (!claimed) return;
      if (!context.code) {
        await handle.advance("failed", "code_unavailable");
        return;
      }

      let sent: { did: string };
      try {
        sent = await sms.sendVerificationCode(context.targetNumber, context.code);
      } catch (error) {
        const reasonCode =
          error instanceof SmsProviderError ? error.reasonCode : "provider_unavailable";
        await handle.advance("failed", reasonCode);
        return;
      }
      await handle.advance("awaiting_response", "code_sent", { smsDid: sent.did });
    },
  };
}

export function productionTransportRegistry(config: ProductionConfig): TransportRegistry {
  return {
    // All three voice methods now have real dialplan/ARI call-control
    // logic on the droplet (see apps/telephony-agent/src/job-poller.ts)
    // and share the same trunk pool — any configured trunk can serve any
    // of them, so all three gate on the same "at least one trunk exists"
    // check. `voice_challenge`'s content precondition (a published
    // challenge) is checked synchronously at creation, not here.
    call_reachability: createNodeDispatchTransport(config),
    voice_code: createNodeDispatchTransport(config),
    voice_challenge: createNodeDispatchTransport(config),
    sms_code: createSmsCodeTransport(config),
  };
}
