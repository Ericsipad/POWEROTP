import type { VerificationState, VerificationType } from "@powerotp/contracts";

export interface TransportContext {
  interactionId: string;
  type: VerificationType;
  targetNumber: string;
}

/**
 * Bound to one interaction. `advance` performs the shared, atomic state
 * transition (writes the event, updates counters, enqueues the callback) so
 * every transport drives the same durable machinery instead of each
 * implementing its own persistence.
 */
export interface TransportHandle {
  advance(state: VerificationState, reasonCode?: string): Promise<void>;
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

export function productionTransportRegistry(): TransportRegistry {
  return {
    call_reachability: unavailableTransport,
    voice_code: unavailableTransport,
    voice_challenge: unavailableTransport,
    sms_code: unavailableTransport,
  };
}
