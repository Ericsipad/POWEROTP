import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostedAuthRealms } from "./hosted-auth-boundaries.js";
import {
  HostedAuthContactScopeSchema,
  HostedAuthCredentialGrantScopeSchema,
  HostedAuthRecoveryScopeSchema,
  HostedAuthVerificationScopeSchema,
  HostedAuthWebAuthnScopeSchema,
} from "./hosted-auth-ceremony-scopes.js";
import { HostedAuthProfileIdSchema } from "./hosted-auth-identifiers.js";
import {
  hostedAuthContactStateMachine,
  hostedAuthWebAuthnStateMachine,
  type HostedAuthWebAuthnEvent,
  type HostedAuthWebAuthnState,
} from "./hosted-auth-proof-state-machines.js";
import {
  hostedAuthCredentialGrantStateMachine,
  hostedAuthRecoveryStateMachine,
  hostedAuthVerificationStateMachine,
} from "./hosted-auth-recovery-state-machines.js";
import {
  hostedAuthPollingStateMachine,
  hostedAuthRequestStateMachine,
  type HostedAuthPollingEvent,
  type HostedAuthPollingState,
  type HostedAuthRequestEvent,
  type HostedAuthRequestState,
} from "./hosted-auth-request-state-machines.js";
import {
  HostedAuthTransitionError,
  applyHostedAuthTransition,
  type HostedAuthMachineSnapshot,
  type HostedAuthMachineScope,
  type HostedAuthStateMachineDefinition,
} from "./hosted-auth-state-machine-core.js";

const projectId = "project_scope_0001";
const otherProjectId = "project_scope_0002";
const canonicalBody = "A".repeat(42) + "E";
const authProfileId = HostedAuthProfileIdSchema.parse(`hap_${canonicalBody}`);

const signupScope = {
  projectId,
  realm: hostedAuthRealms.powerotp_pii,
  flow: "signup",
} as const;
const signinScope = {
  projectId,
  realm: hostedAuthRealms.powerotp_pii,
  flow: "signin",
} as const;

const expectTransitionError = (
  code: HostedAuthTransitionError["code"],
  callback: () => unknown,
) => {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof HostedAuthTransitionError);
    assert.equal(error.code, code);
    return true;
  });
};

describe("hosted auth-request and polling state machines", () => {
  it("applies the complete successful request and polling paths", () => {
    let request: HostedAuthMachineSnapshot<
      HostedAuthRequestState,
      HostedAuthRequestEvent
    > = {
      scope: signupScope,
      state: "created",
      version: 0,
    };
    for (const event of [
      "activate",
      "start_webauthn",
      "authentication_satisfied",
      "start_verification",
      "verification_satisfied",
      "succeed",
    ] as const) {
      const result = applyHostedAuthTransition(
        hostedAuthRequestStateMachine,
        request,
        { scope: signupScope, event, expectedVersion: request.version },
      );
      assert.equal(result.outcome, "applied");
      request = result.snapshot;
    }
    assert.equal(request.state, "succeeded");

    let polling: HostedAuthMachineSnapshot<
      HostedAuthPollingState,
      HostedAuthPollingEvent
    > = {
      scope: signupScope,
      state: "active",
      version: 0,
    };
    const pending = applyHostedAuthTransition(
      hostedAuthPollingStateMachine,
      polling,
      { scope: signupScope, event: "poll_pending", expectedVersion: 0 },
    );
    assert.equal(pending.outcome, "observed");
    assert.strictEqual(pending.snapshot, polling);

    polling = applyHostedAuthTransition(
      hostedAuthPollingStateMachine,
      polling,
      {
        scope: signupScope,
        event: "publish_terminal_result",
        expectedVersion: 0,
      },
    ).snapshot;
    const terminalPoll = applyHostedAuthTransition(
      hostedAuthPollingStateMachine,
      polling,
      {
        scope: signupScope,
        event: "poll_terminal_result",
        expectedVersion: 1,
      },
    );
    assert.equal(terminalPoll.outcome, "observed");
    assert.strictEqual(terminalPoll.snapshot, polling);
  });

  it("permits recovery only inside signin requests", () => {
    const awaitingSignup = {
      scope: signupScope,
      state: "awaiting_user",
      version: 1,
      lastEvent: "activate",
    } as const;
    expectTransitionError("invalid_transition", () =>
      applyHostedAuthTransition(
        hostedAuthRequestStateMachine,
        awaitingSignup,
        {
          scope: signupScope,
          event: "start_recovery",
          expectedVersion: 1,
        },
      ),
    );

    const result = applyHostedAuthTransition(
      hostedAuthRequestStateMachine,
      { ...awaitingSignup, scope: signinScope },
      { scope: signinScope, event: "start_recovery", expectedVersion: 1 },
    );
    assert.equal(result.snapshot.state, "recovering");
  });

  it("rejects illegal transitions and cross-project/realm/flow substitution", () => {
    const current = {
      scope: signupScope,
      state: "awaiting_user",
      version: 1,
      lastEvent: "activate",
    } as const;
    expectTransitionError("invalid_transition", () =>
      applyHostedAuthTransition(hostedAuthRequestStateMachine, current, {
        scope: signupScope,
        event: "succeed",
        expectedVersion: 1,
      }),
    );

    const substitutedScopes: HostedAuthMachineScope[] = [
      { ...signupScope, projectId: otherProjectId },
      { ...signupScope, realm: hostedAuthRealms.didit_pii },
      { ...signupScope, flow: "signin" },
    ];
    for (const scope of substitutedScopes) {
      expectTransitionError("scope_mismatch", () =>
        applyHostedAuthTransition(hostedAuthRequestStateMachine, current, {
          scope,
          event: "start_webauthn",
          expectedVersion: 1,
        }),
      );
    }
  });

  it("keeps terminal states immutable while returning exact replay as duplicate", () => {
    const command = {
      scope: signupScope,
      event: "cancel",
      expectedVersion: 0,
    } as const;
    const canceled = applyHostedAuthTransition(
      hostedAuthRequestStateMachine,
      { scope: signupScope, state: "created", version: 0 },
      command,
    ).snapshot;

    const replay = applyHostedAuthTransition(
      hostedAuthRequestStateMachine,
      canceled,
      command,
    );
    assert.equal(replay.outcome, "duplicate");
    assert.strictEqual(replay.snapshot, canceled);

    expectTransitionError("terminal_immutable", () =>
      applyHostedAuthTransition(hostedAuthRequestStateMachine, canceled, {
        scope: signupScope,
        event: "activate",
        expectedVersion: 1,
      }),
    );
    expectTransitionError("stale_transition", () =>
      applyHostedAuthTransition(hostedAuthRequestStateMachine, canceled, {
        scope: signupScope,
        event: "fail",
        expectedVersion: 0,
      }),
    );
  });
});

describe("hosted WebAuthn and contact proof state machines", () => {
  it("consumes one WebAuthn response and retries with a new challenge", () => {
    const scope = HostedAuthWebAuthnScopeSchema.parse({
      ...signinScope,
      purpose: "signin_authentication",
    });
    let snapshot: HostedAuthMachineSnapshot<
      HostedAuthWebAuthnState,
      HostedAuthWebAuthnEvent,
      typeof scope
    > = {
      scope,
      state: "ready",
      version: 0,
    };
    snapshot = applyHostedAuthTransition(
      hostedAuthWebAuthnStateMachine,
      snapshot,
      { scope, event: "issue_challenge", expectedVersion: 0 },
    ).snapshot;
    const submit = { scope, event: "submit_response", expectedVersion: 1 } as const;
    snapshot = applyHostedAuthTransition(
      hostedAuthWebAuthnStateMachine,
      snapshot,
      submit,
    ).snapshot;
    assert.equal(
      applyHostedAuthTransition(
        hostedAuthWebAuthnStateMachine,
        snapshot,
        submit,
      ).outcome,
      "duplicate",
    );
    snapshot = applyHostedAuthTransition(
      hostedAuthWebAuthnStateMachine,
      snapshot,
      { scope, event: "reject_response", expectedVersion: 2 },
    ).snapshot;
    const retry = applyHostedAuthTransition(
      hostedAuthWebAuthnStateMachine,
      snapshot,
      { scope, event: "retry_with_new_challenge", expectedVersion: 3 },
    );
    assert.equal(retry.outcome, "retry_started");
    assert.equal(retry.snapshot.state, "challenge_issued");
  });

  it("binds contact provider purpose to the exact flow and scope", () => {
    assert.equal(
      HostedAuthContactScopeSchema.safeParse({
        ...signupScope,
        providerPurpose: "recovery_contact_proof",
      }).success,
      false,
    );
    const scope = HostedAuthContactScopeSchema.parse({
      ...signinScope,
      providerPurpose: "recovery_contact_proof",
    });
    const otherPurpose = HostedAuthContactScopeSchema.parse({
      ...signinScope,
      providerPurpose: "signin_contact_authentication",
    });
    expectTransitionError("scope_mismatch", () =>
      applyHostedAuthTransition(
        hostedAuthContactStateMachine,
        { scope, state: "ready", version: 0 },
        {
          scope: otherPurpose,
          event: "send_challenge",
          expectedVersion: 0,
        },
      ),
    );
  });
});

describe("hosted recovery, credential-grant, and verification state machines", () => {
  it("requires signin recovery proof before issuing a credential grant", () => {
    assert.equal(
      HostedAuthRecoveryScopeSchema.safeParse(signupScope).success,
      false,
    );
    const scope = HostedAuthRecoveryScopeSchema.parse(signinScope);
    const invalid = {
      scope,
      state: "awaiting_proof",
      version: 2,
      lastEvent: "require_proof",
    } as const;
    expectTransitionError("invalid_transition", () =>
      applyHostedAuthTransition(hostedAuthRecoveryStateMachine, invalid, {
        scope,
        event: "issue_credential_grant",
        expectedVersion: 2,
      }),
    );
    const proved = applyHostedAuthTransition(
      hostedAuthRecoveryStateMachine,
      invalid,
      { scope, event: "accept_proof", expectedVersion: 2 },
    ).snapshot;
    assert.equal(
      applyHostedAuthTransition(hostedAuthRecoveryStateMachine, proved, {
        scope,
        event: "issue_credential_grant",
        expectedVersion: 3,
      }).snapshot.state,
      "grant_issued",
    );
  });

  it("binds one-time credential grants to profile, realm, project, flow, and action", () => {
    const scope = HostedAuthCredentialGrantScopeSchema.parse({
      ...signinScope,
      authProfileId,
      grantScope: "add_credential",
      authorizedBy: "completed_recovery",
    });
    const substitutions = [
      HostedAuthCredentialGrantScopeSchema.parse({
        ...scope,
        projectId: otherProjectId,
      }),
      HostedAuthCredentialGrantScopeSchema.parse({
        ...scope,
        realm: hostedAuthRealms.didit_pii,
      }),
      HostedAuthCredentialGrantScopeSchema.parse({
        ...scope,
        flow: "signup",
      }),
      HostedAuthCredentialGrantScopeSchema.parse({
        ...scope,
        grantScope: "revoke_credential",
      }),
      HostedAuthCredentialGrantScopeSchema.parse({
        ...scope,
        authorizedBy: "fresh_authentication",
      }),
      HostedAuthCredentialGrantScopeSchema.parse({
        ...scope,
        authProfileId: HostedAuthProfileIdSchema.parse(
          `hap_${"B".repeat(42)}E`,
        ),
      }),
    ];
    for (const substituted of substitutions) {
      expectTransitionError("scope_mismatch", () =>
        applyHostedAuthTransition(
          hostedAuthCredentialGrantStateMachine,
          { scope, state: "issued", version: 0 },
          {
            scope: substituted,
            event: "begin_consumption",
            expectedVersion: 0,
          },
        ),
      );
    }

    const consuming = applyHostedAuthTransition(
      hostedAuthCredentialGrantStateMachine,
      { scope, state: "issued", version: 0 },
      { scope, event: "begin_consumption", expectedVersion: 0 },
    ).snapshot;
    const consumed = applyHostedAuthTransition(
      hostedAuthCredentialGrantStateMachine,
      consuming,
      { scope, event: "accept_consumption", expectedVersion: 1 },
    ).snapshot;
    expectTransitionError("terminal_immutable", () =>
      applyHostedAuthTransition(
        hostedAuthCredentialGrantStateMachine,
        consumed,
        { scope, event: "begin_consumption", expectedVersion: 2 },
      ),
    );
  });

  it("keeps verification purposes explicit and provider retries fresh", () => {
    assert.equal(
      HostedAuthVerificationScopeSchema.safeParse({
        ...signupScope,
        providerPurpose: "fresh_biometric_authentication",
      }).success,
      false,
    );
    const scope = HostedAuthVerificationScopeSchema.parse({
      ...signupScope,
      providerPurpose: "age_assurance",
    });
    const pending = applyHostedAuthTransition(
      hostedAuthVerificationStateMachine,
      { scope, state: "ready", version: 0 },
      { scope, event: "start_provider_operation", expectedVersion: 0 },
    ).snapshot;
    const failed = applyHostedAuthTransition(
      hostedAuthVerificationStateMachine,
      pending,
      { scope, event: "report_retryable_failure", expectedVersion: 1 },
    ).snapshot;
    const retried = applyHostedAuthTransition(
      hostedAuthVerificationStateMachine,
      failed,
      { scope, event: "retry_with_new_operation", expectedVersion: 2 },
    );
    assert.equal(retried.outcome, "retry_started");
    assert.equal(retried.snapshot.state, "provider_operation_pending");
  });
});

describe("state-machine definition invariants", () => {
  it("has no duplicate rules or outgoing terminal transitions", () => {
    const definitions: HostedAuthStateMachineDefinition<
      string,
      string,
      HostedAuthMachineScope
    >[] = [
      hostedAuthRequestStateMachine,
      hostedAuthPollingStateMachine,
      hostedAuthWebAuthnStateMachine,
      hostedAuthContactStateMachine,
      hostedAuthRecoveryStateMachine,
      hostedAuthCredentialGrantStateMachine,
      hostedAuthVerificationStateMachine,
    ];
    for (const definition of definitions) {
      const keys = definition.rules.map((rule) => `${rule.from}:${rule.event}`);
      assert.equal(new Set(keys).size, keys.length, definition.name);
      for (const terminal of definition.terminalStates) {
        assert.equal(
          definition.rules.some((rule) => rule.from === terminal),
          false,
          `${definition.name}:${terminal}`,
        );
      }
    }
  });
});
