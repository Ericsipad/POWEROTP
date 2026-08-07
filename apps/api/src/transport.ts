import type { VerificationState, VerificationType } from "@powerotp/contracts";

import type { ProductionConfig } from "./config.js";
import { outboundTrunkFor, type VoiceVerificationType } from "./outbound-trunks.js";
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
  advance(state: VerificationState, reasonCode?: string): Promise<boolean>;
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
 * over localhost-only ARI — so all this transport does is confirm a trunk
 * is actually configured for the method (still `unavailableTransport`
 * otherwise, unchanged from before) and advance to `dispatching`, which is
 * the signal a node polls for.
 */
function createNodeDispatchTransport(
  config: Pick<
    ProductionConfig,
    "OUTBOUND1_URL" | "OUTBOUND1_USER" | "OUTBOUND1_PASS" |
    "OUTBOUND2_URL" | "OUTBOUND2_USER" | "OUTBOUND2_PASS" |
    "OUTBOUND3_URL" | "OUTBOUND3_USER" | "OUTBOUND3_PASS"
  >,
  type: VoiceVerificationType,
): VerificationTransport {
  return {
    async dispatch(context, handle) {
      if (!outboundTrunkFor(config, type)) {
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

      try {
        await sms.sendVerificationCode(context.targetNumber, context.code);
      } catch (error) {
        const reasonCode =
          error instanceof SmsProviderError ? error.reasonCode : "provider_unavailable";
        await handle.advance("failed", reasonCode);
        return;
      }
      await handle.advance("awaiting_response", "code_sent");
    },
  };
}

export function productionTransportRegistry(config: ProductionConfig): TransportRegistry {
  return {
    // The two methods with real dialplan/ARI call-control logic on the
    // droplet so far (see apps/telephony-agent/src/job-poller.ts). The
    // other two stay on the unavailable stub until their own call-control
    // logic exists, even after their trunks are configured — otherwise
    // their interactions would sit in `dispatching` for the full
    // interaction lifetime with no node ever able to execute them.
    call_reachability: createNodeDispatchTransport(config, "call_reachability"),
    voice_code: createNodeDispatchTransport(config, "voice_code"),
    voice_challenge: unavailableTransport,
    sms_code: createSmsCodeTransport(config),
  };
}
