import { z } from "zod";

import {
  HostedAuthMachineScopeSchema,
  type HostedAuthStateMachineDefinition,
  type HostedAuthTransitionRule,
} from "./hosted-auth-state-machine-core.js";

export const hostedAuthRequestStates = [
  "created",
  "awaiting_user",
  "authenticating",
  "verifying_contact",
  "recovering",
  "proof_satisfied",
  "verifying_assurance",
  "publishing_result",
  "succeeded",
  "failed",
  "canceled",
  "expired",
] as const;
export const HostedAuthRequestStateSchema = z.enum(hostedAuthRequestStates);

export const hostedAuthRequestEvents = [
  "activate",
  "start_webauthn",
  "start_contact",
  "start_recovery",
  "authentication_satisfied",
  "contact_satisfied",
  "recovery_satisfied",
  "retry_authentication",
  "retry_contact",
  "retry_recovery",
  "start_verification",
  "skip_verification",
  "verification_satisfied",
  "retry_verification",
  "succeed",
  "fail",
  "cancel",
  "expire",
] as const;
export const HostedAuthRequestEventSchema = z.enum(hostedAuthRequestEvents);

export const terminalHostedAuthRequestStates = [
  "succeeded",
  "failed",
  "canceled",
  "expired",
] as const;

type RequestState = z.infer<typeof HostedAuthRequestStateSchema>;
type RequestEvent = z.infer<typeof HostedAuthRequestEventSchema>;

const requestRules: HostedAuthTransitionRule<RequestState, RequestEvent>[] = [
  { from: "created", event: "activate", to: "awaiting_user", behavior: "transition" },
  {
    from: "awaiting_user",
    event: "start_webauthn",
    to: "authenticating",
    behavior: "transition",
  },
  {
    from: "awaiting_user",
    event: "start_contact",
    to: "verifying_contact",
    behavior: "transition",
  },
  {
    from: "awaiting_user",
    event: "start_recovery",
    to: "recovering",
    behavior: "transition",
    scopeGuard: (scope) => scope.flow === "signin",
  },
  {
    from: "authenticating",
    event: "authentication_satisfied",
    to: "proof_satisfied",
    behavior: "transition",
  },
  {
    from: "verifying_contact",
    event: "contact_satisfied",
    to: "proof_satisfied",
    behavior: "transition",
  },
  {
    from: "recovering",
    event: "recovery_satisfied",
    to: "proof_satisfied",
    behavior: "transition",
  },
  {
    from: "authenticating",
    event: "retry_authentication",
    to: "authenticating",
    behavior: "retry",
  },
  {
    from: "verifying_contact",
    event: "retry_contact",
    to: "verifying_contact",
    behavior: "retry",
  },
  {
    from: "recovering",
    event: "retry_recovery",
    to: "recovering",
    behavior: "retry",
  },
  {
    from: "proof_satisfied",
    event: "start_verification",
    to: "verifying_assurance",
    behavior: "transition",
  },
  {
    from: "proof_satisfied",
    event: "skip_verification",
    to: "publishing_result",
    behavior: "transition",
  },
  {
    from: "verifying_assurance",
    event: "verification_satisfied",
    to: "publishing_result",
    behavior: "transition",
  },
  {
    from: "verifying_assurance",
    event: "retry_verification",
    to: "verifying_assurance",
    behavior: "retry",
  },
  {
    from: "publishing_result",
    event: "succeed",
    to: "succeeded",
    behavior: "transition",
  },
];

const activeRequestStates = hostedAuthRequestStates.filter(
  (state) => !terminalHostedAuthRequestStates.includes(
    state as (typeof terminalHostedAuthRequestStates)[number],
  ),
);
for (const state of activeRequestStates) {
  requestRules.push(
    { from: state, event: "fail", to: "failed", behavior: "transition" },
    { from: state, event: "cancel", to: "canceled", behavior: "transition" },
    { from: state, event: "expire", to: "expired", behavior: "transition" },
  );
}

export const hostedAuthRequestStateMachine = {
  name: "auth_request",
  scopeSchema: HostedAuthMachineScopeSchema,
  states: hostedAuthRequestStates,
  events: hostedAuthRequestEvents,
  terminalStates: terminalHostedAuthRequestStates,
  rules: requestRules,
} satisfies HostedAuthStateMachineDefinition<RequestState, RequestEvent>;

export const hostedAuthPollingStates = [
  "active",
  "terminal_result_available",
  "purged",
] as const;
export const HostedAuthPollingStateSchema = z.enum(hostedAuthPollingStates);

export const hostedAuthPollingEvents = [
  "poll_pending",
  "publish_terminal_result",
  "poll_terminal_result",
  "purge_result",
] as const;
export const HostedAuthPollingEventSchema = z.enum(hostedAuthPollingEvents);

type PollingState = z.infer<typeof HostedAuthPollingStateSchema>;
type PollingEvent = z.infer<typeof HostedAuthPollingEventSchema>;

export const hostedAuthPollingStateMachine = {
  name: "polling",
  scopeSchema: HostedAuthMachineScopeSchema,
  states: hostedAuthPollingStates,
  events: hostedAuthPollingEvents,
  terminalStates: ["purged"],
  rules: [
    {
      from: "active",
      event: "poll_pending",
      to: "active",
      behavior: "observe",
    },
    {
      from: "active",
      event: "publish_terminal_result",
      to: "terminal_result_available",
      behavior: "transition",
    },
    {
      from: "terminal_result_available",
      event: "poll_terminal_result",
      to: "terminal_result_available",
      behavior: "observe",
    },
    {
      from: "terminal_result_available",
      event: "purge_result",
      to: "purged",
      behavior: "transition",
    },
  ],
} satisfies HostedAuthStateMachineDefinition<PollingState, PollingEvent>;

export type HostedAuthRequestState = RequestState;
export type HostedAuthRequestEvent = RequestEvent;
export type HostedAuthPollingState = PollingState;
export type HostedAuthPollingEvent = PollingEvent;
