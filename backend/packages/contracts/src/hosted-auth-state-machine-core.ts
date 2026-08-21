import { z } from "zod";

import { HostedAuthRealmSchema } from "./hosted-auth-boundaries.js";

export const HostedAuthFlowSchema = z.enum(["signup", "signin"]);

/**
 * Scope shared by every hosted-auth machine. The complete realm object is
 * retained so mode/origin/RP substitutions fail before transition logic runs.
 */
export const HostedAuthMachineScopeSchema = z
  .object({
    projectId: z.string().min(16).max(200),
    realm: HostedAuthRealmSchema,
    flow: HostedAuthFlowSchema,
  })
  .strict();

export const HostedAuthMachineVersionSchema = z.number().int().nonnegative();

export type HostedAuthFlow = z.infer<typeof HostedAuthFlowSchema>;
export type HostedAuthMachineScope = z.infer<
  typeof HostedAuthMachineScopeSchema
>;

export type HostedAuthTransitionRule<State extends string, Event extends string> =
  Readonly<{
    from: State;
    event: Event;
    to: State;
    behavior: "transition" | "retry" | "observe";
    scopeGuard?: (scope: HostedAuthMachineScope) => boolean;
  }>;

export type HostedAuthStateMachineDefinition<
  State extends string,
  Event extends string,
  Scope extends HostedAuthMachineScope = HostedAuthMachineScope,
> = Readonly<{
  name: string;
  scopeSchema: z.ZodType<Scope>;
  states: readonly State[];
  events: readonly Event[];
  terminalStates: readonly State[];
  rules: readonly HostedAuthTransitionRule<State, Event>[];
}>;

export type HostedAuthMachineSnapshot<
  State extends string,
  Event extends string,
  Scope extends HostedAuthMachineScope = HostedAuthMachineScope,
> = Readonly<{
  scope: Scope;
  state: State;
  version: number;
  lastEvent?: Event;
}>;

export type HostedAuthTransitionCommand<
  Event extends string,
  Scope extends HostedAuthMachineScope = HostedAuthMachineScope,
> = Readonly<{
  scope: Scope;
  event: Event;
  expectedVersion: number;
}>;

export type HostedAuthTransitionResult<
  State extends string,
  Event extends string,
  Scope extends HostedAuthMachineScope = HostedAuthMachineScope,
> =
  | Readonly<{
      outcome: "applied" | "retry_started";
      snapshot: HostedAuthMachineSnapshot<State, Event, Scope>;
    }>
  | Readonly<{
      outcome: "observed" | "duplicate";
      snapshot: HostedAuthMachineSnapshot<State, Event, Scope>;
    }>;

export type HostedAuthTransitionErrorCode =
  | "invalid_state"
  | "invalid_event"
  | "scope_mismatch"
  | "stale_transition"
  | "terminal_immutable"
  | "invalid_transition";

export class HostedAuthTransitionError extends Error {
  constructor(public readonly code: HostedAuthTransitionErrorCode) {
    super(code);
    this.name = "HostedAuthTransitionError";
  }
}

const sameScope = (
  left: HostedAuthMachineScope,
  right: HostedAuthMachineScope,
): boolean =>
  left.projectId === right.projectId &&
  left.flow === right.flow &&
  left.realm.identityDataMode === right.realm.identityDataMode &&
  left.realm.origin === right.realm.origin &&
  left.realm.rpId === right.realm.rpId &&
  Object.entries(left).every(([key, value]) => {
    if (key === "projectId" || key === "flow" || key === "realm") {
      return true;
    }
    return JSON.stringify(value) === JSON.stringify(right[key as keyof typeof right]);
  }) &&
  Object.keys(left).length === Object.keys(right).length;

/**
 * Pure, optimistic-concurrency transition reducer.
 *
 * Replaying the immediately applied event at its old version is an idempotent
 * duplicate. Any different stale command is rejected. Observe rules never
 * mutate state/version, while retry rules advance version without reviving
 * consumed operation material. New commands can never mutate terminal states.
 */
export function applyHostedAuthTransition<
  State extends string,
  Event extends string,
  Scope extends HostedAuthMachineScope,
>(
  definition: HostedAuthStateMachineDefinition<State, Event, Scope>,
  current: HostedAuthMachineSnapshot<State, Event, Scope>,
  command: HostedAuthTransitionCommand<Event, Scope>,
): HostedAuthTransitionResult<State, Event, Scope> {
  const currentScope = definition.scopeSchema.parse(current.scope);
  const commandScope = definition.scopeSchema.parse(command.scope);
  HostedAuthMachineVersionSchema.parse(current.version);
  HostedAuthMachineVersionSchema.parse(command.expectedVersion);

  if (!definition.states.includes(current.state)) {
    throw new HostedAuthTransitionError("invalid_state");
  }
  if (!definition.events.includes(command.event)) {
    throw new HostedAuthTransitionError("invalid_event");
  }
  if (!sameScope(currentScope, commandScope)) {
    throw new HostedAuthTransitionError("scope_mismatch");
  }

  if (
    command.expectedVersion === current.version - 1 &&
    command.event === current.lastEvent
  ) {
    return { outcome: "duplicate", snapshot: current };
  }
  if (command.expectedVersion !== current.version) {
    throw new HostedAuthTransitionError("stale_transition");
  }
  if (definition.terminalStates.includes(current.state)) {
    throw new HostedAuthTransitionError("terminal_immutable");
  }

  const rule = definition.rules.find(
    (candidate) =>
      candidate.from === current.state &&
      candidate.event === command.event &&
      (candidate.scopeGuard?.(currentScope) ?? true),
  );
  if (!rule) {
    throw new HostedAuthTransitionError("invalid_transition");
  }
  if (rule.behavior === "observe") {
    return { outcome: "observed", snapshot: current };
  }

  const snapshot = {
    scope: currentScope,
    state: rule.to,
    version: current.version + 1,
    lastEvent: command.event,
  } satisfies HostedAuthMachineSnapshot<State, Event, Scope>;
  return {
    outcome: rule.behavior === "retry" ? "retry_started" : "applied",
    snapshot,
  };
}
