import type { TransportContext, TransportHandle, VerificationTransport } from "../transport.js";

/**
 * TEST-ONLY transport. It must never be imported by production code
 * (server.ts, app.ts, dependencies.ts, or transport.ts's production
 * registry): it is only referenced from `*.test.ts` files, which is the
 * mechanism that keeps it impossible to enable outside automated tests.
 * It simulates the shared lifecycle so the durable state machine, queue,
 * callbacks, and interaction tokens can be exercised end to end without
 * touching real telephony or SMS providers.
 */
export type FakeOutcome = "answered" | "no_answer" | "busy";

export function createFakeTransport(outcome: FakeOutcome = "answered"): VerificationTransport {
  return {
    async dispatch(context: TransportContext, handle: TransportHandle) {
      await handle.advance("dispatching");

      if (context.type === "sms_code") {
        if (outcome !== "answered") {
          await handle.advance("failed", "provider_rejected");
          return;
        }
        await handle.advance("awaiting_response");
        return;
      }

      await handle.advance("calling");
      await handle.advance("ringing");

      if (outcome === "no_answer") {
        await handle.advance("failed", "no_answer");
        return;
      }
      if (outcome === "busy") {
        await handle.advance("failed", "busy");
        return;
      }

      await handle.advance("answered");

      if (context.type === "call_reachability") {
        await handle.advance("succeeded", "answered");
        return;
      }

      await handle.advance("playing");
      await handle.advance("awaiting_response");
    },
  };
}
