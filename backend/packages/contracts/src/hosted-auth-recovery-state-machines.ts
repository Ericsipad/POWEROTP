import { z } from "zod";

import {
  HostedAuthCredentialGrantScopeSchema,
  HostedAuthRecoveryScopeSchema,
  HostedAuthVerificationScopeSchema,
  type HostedAuthCredentialGrantScope,
  type HostedAuthRecoveryScope,
  type HostedAuthVerificationScope,
} from "./hosted-auth-ceremony-scopes.js";
import type {
  HostedAuthStateMachineDefinition,
  HostedAuthTransitionRule,
} from "./hosted-auth-state-machine-core.js";

export const hostedAuthRecoveryStates = [
  "ready",
  "discovering",
  "awaiting_proof",
  "delay_pending",
  "proof_satisfied",
  "grant_issued",
  "completed",
  "failed",
  "canceled",
  "expired",
] as const;
export const HostedAuthRecoveryStateSchema = z.enum(hostedAuthRecoveryStates);

export const hostedAuthRecoveryEvents = [
  "begin_discovery",
  "require_proof",
  "begin_security_delay",
  "complete_security_delay",
  "accept_proof",
  "retry_proof",
  "issue_credential_grant",
  "complete_recovery",
  "fail",
  "cancel",
  "expire",
] as const;
export const HostedAuthRecoveryEventSchema = z.enum(hostedAuthRecoveryEvents);

type RecoveryState = z.infer<typeof HostedAuthRecoveryStateSchema>;
type RecoveryEvent = z.infer<typeof HostedAuthRecoveryEventSchema>;

const recoveryRules: HostedAuthTransitionRule<RecoveryState, RecoveryEvent>[] = [
  {
    from: "ready",
    event: "begin_discovery",
    to: "discovering",
    behavior: "transition",
  },
  {
    from: "discovering",
    event: "require_proof",
    to: "awaiting_proof",
    behavior: "transition",
  },
  {
    from: "awaiting_proof",
    event: "accept_proof",
    to: "proof_satisfied",
    behavior: "transition",
  },
  {
    from: "awaiting_proof",
    event: "begin_security_delay",
    to: "delay_pending",
    behavior: "transition",
  },
  {
    from: "delay_pending",
    event: "complete_security_delay",
    to: "proof_satisfied",
    behavior: "transition",
  },
  {
    from: "awaiting_proof",
    event: "retry_proof",
    to: "awaiting_proof",
    behavior: "retry",
  },
  {
    from: "proof_satisfied",
    event: "issue_credential_grant",
    to: "grant_issued",
    behavior: "transition",
  },
  {
    from: "grant_issued",
    event: "complete_recovery",
    to: "completed",
    behavior: "transition",
  },
];

for (const state of hostedAuthRecoveryStates.filter(
  (value) => !["completed", "failed", "canceled", "expired"].includes(value),
)) {
  recoveryRules.push(
    { from: state, event: "fail", to: "failed", behavior: "transition" },
    { from: state, event: "cancel", to: "canceled", behavior: "transition" },
    { from: state, event: "expire", to: "expired", behavior: "transition" },
  );
}

export const hostedAuthRecoveryStateMachine = {
  name: "recovery",
  scopeSchema: HostedAuthRecoveryScopeSchema,
  states: hostedAuthRecoveryStates,
  events: hostedAuthRecoveryEvents,
  terminalStates: ["completed", "failed", "canceled", "expired"],
  rules: recoveryRules,
} satisfies HostedAuthStateMachineDefinition<
  RecoveryState,
  RecoveryEvent,
  HostedAuthRecoveryScope
>;

export const hostedAuthCredentialGrantStates = [
  "issued",
  "consuming",
  "consumption_rejected",
  "consumed",
  "canceled",
  "expired",
] as const;
export const HostedAuthCredentialGrantStateSchema = z.enum(
  hostedAuthCredentialGrantStates,
);

export const hostedAuthCredentialGrantEvents = [
  "begin_consumption",
  "accept_consumption",
  "reject_consumption",
  "retry_consumption",
  "cancel",
  "expire",
] as const;
export const HostedAuthCredentialGrantEventSchema = z.enum(
  hostedAuthCredentialGrantEvents,
);

type GrantState = z.infer<typeof HostedAuthCredentialGrantStateSchema>;
type GrantEvent = z.infer<typeof HostedAuthCredentialGrantEventSchema>;

const grantRules: HostedAuthTransitionRule<GrantState, GrantEvent>[] = [
  {
    from: "issued",
    event: "begin_consumption",
    to: "consuming",
    behavior: "transition",
  },
  {
    from: "consuming",
    event: "accept_consumption",
    to: "consumed",
    behavior: "transition",
  },
  {
    from: "consuming",
    event: "reject_consumption",
    to: "consumption_rejected",
    behavior: "transition",
  },
  {
    from: "consumption_rejected",
    event: "retry_consumption",
    to: "consuming",
    behavior: "retry",
  },
];

for (const state of ["issued", "consuming", "consumption_rejected"] as const) {
  grantRules.push(
    { from: state, event: "cancel", to: "canceled", behavior: "transition" },
    { from: state, event: "expire", to: "expired", behavior: "transition" },
  );
}

export const hostedAuthCredentialGrantStateMachine = {
  name: "credential_grant",
  scopeSchema: HostedAuthCredentialGrantScopeSchema,
  states: hostedAuthCredentialGrantStates,
  events: hostedAuthCredentialGrantEvents,
  terminalStates: ["consumed", "canceled", "expired"],
  rules: grantRules,
} satisfies HostedAuthStateMachineDefinition<
  GrantState,
  GrantEvent,
  HostedAuthCredentialGrantScope
>;

export const hostedAuthVerificationStates = [
  "ready",
  "provider_operation_pending",
  "decision_received",
  "retryable_failure",
  "satisfied",
  "not_satisfied",
  "indeterminate",
  "declined",
  "canceled",
  "expired",
] as const;
export const HostedAuthVerificationStateSchema = z.enum(
  hostedAuthVerificationStates,
);

export const hostedAuthVerificationEvents = [
  "start_provider_operation",
  "receive_decision",
  "accept_decision",
  "reject_decision",
  "mark_indeterminate",
  "report_retryable_failure",
  "retry_with_new_operation",
  "decline",
  "cancel",
  "expire",
] as const;
export const HostedAuthVerificationEventSchema = z.enum(
  hostedAuthVerificationEvents,
);

type VerificationState = z.infer<typeof HostedAuthVerificationStateSchema>;
type VerificationEvent = z.infer<typeof HostedAuthVerificationEventSchema>;

const verificationRules: HostedAuthTransitionRule<
  VerificationState,
  VerificationEvent
>[] = [
  {
    from: "ready",
    event: "start_provider_operation",
    to: "provider_operation_pending",
    behavior: "transition",
  },
  {
    from: "provider_operation_pending",
    event: "receive_decision",
    to: "decision_received",
    behavior: "transition",
  },
  {
    from: "provider_operation_pending",
    event: "report_retryable_failure",
    to: "retryable_failure",
    behavior: "transition",
  },
  {
    from: "retryable_failure",
    event: "retry_with_new_operation",
    to: "provider_operation_pending",
    behavior: "retry",
  },
  {
    from: "decision_received",
    event: "accept_decision",
    to: "satisfied",
    behavior: "transition",
  },
  {
    from: "decision_received",
    event: "reject_decision",
    to: "not_satisfied",
    behavior: "transition",
  },
  {
    from: "decision_received",
    event: "mark_indeterminate",
    to: "indeterminate",
    behavior: "transition",
  },
];

for (const state of hostedAuthVerificationStates.filter(
  (value) =>
    ![
      "satisfied",
      "not_satisfied",
      "indeterminate",
      "declined",
      "canceled",
      "expired",
    ].includes(value),
)) {
  verificationRules.push(
    { from: state, event: "decline", to: "declined", behavior: "transition" },
    { from: state, event: "cancel", to: "canceled", behavior: "transition" },
    { from: state, event: "expire", to: "expired", behavior: "transition" },
  );
}

export const hostedAuthVerificationStateMachine = {
  name: "verification",
  scopeSchema: HostedAuthVerificationScopeSchema,
  states: hostedAuthVerificationStates,
  events: hostedAuthVerificationEvents,
  terminalStates: [
    "satisfied",
    "not_satisfied",
    "indeterminate",
    "declined",
    "canceled",
    "expired",
  ],
  rules: verificationRules,
} satisfies HostedAuthStateMachineDefinition<
  VerificationState,
  VerificationEvent,
  HostedAuthVerificationScope
>;

export type HostedAuthRecoveryState = RecoveryState;
export type HostedAuthRecoveryEvent = RecoveryEvent;
export type HostedAuthCredentialGrantState = GrantState;
export type HostedAuthCredentialGrantEvent = GrantEvent;
export type HostedAuthVerificationState = VerificationState;
export type HostedAuthVerificationEvent = VerificationEvent;
