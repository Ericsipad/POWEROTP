import { z } from "zod";

import {
  HostedAuthContactScopeSchema,
  HostedAuthWebAuthnScopeSchema,
  type HostedAuthContactScope,
  type HostedAuthWebAuthnScope,
} from "./hosted-auth-ceremony-scopes.js";
import type {
  HostedAuthStateMachineDefinition,
  HostedAuthTransitionRule,
} from "./hosted-auth-state-machine-core.js";

export const hostedAuthWebAuthnStates = [
  "ready",
  "challenge_issued",
  "verifying",
  "challenge_rejected",
  "verified",
  "canceled",
  "expired",
] as const;
export const HostedAuthWebAuthnStateSchema = z.enum(hostedAuthWebAuthnStates);

export const hostedAuthWebAuthnEvents = [
  "issue_challenge",
  "submit_response",
  "accept_response",
  "reject_response",
  "retry_with_new_challenge",
  "cancel",
  "expire",
] as const;
export const HostedAuthWebAuthnEventSchema = z.enum(hostedAuthWebAuthnEvents);

type WebAuthnState = z.infer<typeof HostedAuthWebAuthnStateSchema>;
type WebAuthnEvent = z.infer<typeof HostedAuthWebAuthnEventSchema>;

const webAuthnRules: HostedAuthTransitionRule<WebAuthnState, WebAuthnEvent>[] = [
  {
    from: "ready",
    event: "issue_challenge",
    to: "challenge_issued",
    behavior: "transition",
  },
  {
    from: "challenge_issued",
    event: "submit_response",
    to: "verifying",
    behavior: "transition",
  },
  {
    from: "verifying",
    event: "accept_response",
    to: "verified",
    behavior: "transition",
  },
  {
    from: "verifying",
    event: "reject_response",
    to: "challenge_rejected",
    behavior: "transition",
  },
  {
    from: "challenge_rejected",
    event: "retry_with_new_challenge",
    to: "challenge_issued",
    behavior: "retry",
  },
];

for (const state of hostedAuthWebAuthnStates.filter(
  (value) => !["verified", "canceled", "expired"].includes(value),
)) {
  webAuthnRules.push(
    { from: state, event: "cancel", to: "canceled", behavior: "transition" },
    { from: state, event: "expire", to: "expired", behavior: "transition" },
  );
}

export const hostedAuthWebAuthnStateMachine = {
  name: "webauthn",
  scopeSchema: HostedAuthWebAuthnScopeSchema,
  states: hostedAuthWebAuthnStates,
  events: hostedAuthWebAuthnEvents,
  terminalStates: ["verified", "canceled", "expired"],
  rules: webAuthnRules,
} satisfies HostedAuthStateMachineDefinition<
  WebAuthnState,
  WebAuthnEvent,
  HostedAuthWebAuthnScope
>;

export const hostedAuthContactStates = [
  "ready",
  "challenge_sent",
  "delivery_failed",
  "proof_submitted",
  "proof_rejected",
  "verified",
  "declined",
  "canceled",
  "expired",
] as const;
export const HostedAuthContactStateSchema = z.enum(hostedAuthContactStates);

export const hostedAuthContactEvents = [
  "send_challenge",
  "report_delivery_failure",
  "submit_proof",
  "accept_proof",
  "reject_proof",
  "decline",
  "retry_delivery",
  "retry_with_new_challenge",
  "cancel",
  "expire",
] as const;
export const HostedAuthContactEventSchema = z.enum(hostedAuthContactEvents);

type ContactState = z.infer<typeof HostedAuthContactStateSchema>;
type ContactEvent = z.infer<typeof HostedAuthContactEventSchema>;

const contactRules: HostedAuthTransitionRule<ContactState, ContactEvent>[] = [
  {
    from: "ready",
    event: "send_challenge",
    to: "challenge_sent",
    behavior: "transition",
  },
  {
    from: "challenge_sent",
    event: "report_delivery_failure",
    to: "delivery_failed",
    behavior: "transition",
  },
  {
    from: "delivery_failed",
    event: "retry_delivery",
    to: "challenge_sent",
    behavior: "retry",
  },
  {
    from: "challenge_sent",
    event: "submit_proof",
    to: "proof_submitted",
    behavior: "transition",
  },
  {
    from: "proof_submitted",
    event: "accept_proof",
    to: "verified",
    behavior: "transition",
  },
  {
    from: "proof_submitted",
    event: "reject_proof",
    to: "proof_rejected",
    behavior: "transition",
  },
  {
    from: "proof_rejected",
    event: "retry_with_new_challenge",
    to: "challenge_sent",
    behavior: "retry",
  },
];

for (const state of hostedAuthContactStates.filter(
  (value) => !["verified", "declined", "canceled", "expired"].includes(value),
)) {
  contactRules.push(
    { from: state, event: "decline", to: "declined", behavior: "transition" },
    { from: state, event: "cancel", to: "canceled", behavior: "transition" },
    { from: state, event: "expire", to: "expired", behavior: "transition" },
  );
}

export const hostedAuthContactStateMachine = {
  name: "contact",
  scopeSchema: HostedAuthContactScopeSchema,
  states: hostedAuthContactStates,
  events: hostedAuthContactEvents,
  terminalStates: ["verified", "declined", "canceled", "expired"],
  rules: contactRules,
} satisfies HostedAuthStateMachineDefinition<
  ContactState,
  ContactEvent,
  HostedAuthContactScope
>;

export type HostedAuthWebAuthnState = WebAuthnState;
export type HostedAuthWebAuthnEvent = WebAuthnEvent;
export type HostedAuthContactState = ContactState;
export type HostedAuthContactEvent = ContactEvent;
