import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostedAuthRealms } from "./hosted-auth-boundaries.js";
import {
  HostedAuthBalanceOperationRequestSchema,
  HostedAuthBalanceOperationResultSchema,
} from "./hosted-auth-balance-operation.js";
import {
  HostedAuthContactScopeSchema,
  HostedAuthVerificationScopeSchema,
} from "./hosted-auth-ceremony-scopes.js";
import {
  DiditInternalIdSchema,
  HostedAuthRequestIdSchema,
  HostedPersonIdentityIdSchema,
  PotpDiditIdSchema,
} from "./hosted-auth-identifiers.js";
import {
  HostedAuthDiditDecisionSchema,
  HostedAuthDiditUserRequestSchema,
  HostedAuthDiditUserResultSchema,
  HostedAuthDiditVerificationRequestSchema,
  HostedAuthEmailChallengeRequestSchema,
  HostedAuthEmailProofRequestSchema,
  HostedAuthPhoneChallengeRequestSchema,
  HostedAuthPhoneProofRequestSchema,
} from "./hosted-auth-provider-interfaces.js";

const canonicalBody = "A".repeat(42) + "E";
const projectId = "project_scope_0001";
const otherProjectId = "project_scope_0002";
const authRequestId = HostedAuthRequestIdSchema.parse(`har_${canonicalBody}`);
const personId = HostedPersonIdentityIdSchema.parse(`hpi_${canonicalBody}`);
const potpDiditId = PotpDiditIdSchema.parse(`pdi_${canonicalBody}`);
const diditInternalId = DiditInternalIdSchema.parse(
  "123e4567-e89b-42d3-a456-426614174000",
);
const providerOperationId = "provider_operation_0001";

const powerOtpSignupContactScope = HostedAuthContactScopeSchema.parse({
  projectId,
  realm: hostedAuthRealms.powerotp_pii,
  flow: "signup",
  providerPurpose: "signup_contact_enrollment",
});
const diditSigninContactScope = HostedAuthContactScopeSchema.parse({
  projectId,
  realm: hostedAuthRealms.didit_pii,
  flow: "signin",
  providerPurpose: "signin_contact_authentication",
});

describe("hosted-auth email and phone provider interfaces", () => {
  it("routes email providers through the immutable contact-custody mode", () => {
    assert.equal(
      HostedAuthEmailChallengeRequestSchema.safeParse({
        authRequestId,
        scope: powerOtpSignupContactScope,
        provider: "powerotp_email",
        destination: "person@example.com",
      }).success,
      true,
    );
    assert.equal(
      HostedAuthEmailChallengeRequestSchema.safeParse({
        authRequestId,
        scope: powerOtpSignupContactScope,
        provider: "didit_email",
        destination: "person@example.com",
      }).success,
      false,
    );
    assert.equal(
      HostedAuthEmailChallengeRequestSchema.safeParse({
        authRequestId,
        scope: diditSigninContactScope,
        provider: "powerotp_email",
        destination: "person@example.com",
      }).success,
      false,
    );
  });

  it("keeps phone delivery and proof operations channel- and purpose-specific", () => {
    assert.equal(
      HostedAuthPhoneChallengeRequestSchema.safeParse({
        authRequestId,
        scope: diditSigninContactScope,
        provider: "didit_phone",
        destination: "+15551234567",
      }).success,
      true,
    );
    assert.equal(
      HostedAuthPhoneChallengeRequestSchema.safeParse({
        authRequestId,
        scope: diditSigninContactScope,
        provider: "didit_phone",
        destination: "555-123-4567",
      }).success,
      false,
    );
    assert.equal(
      HostedAuthEmailProofRequestSchema.safeParse({
        authRequestId,
        scope: powerOtpSignupContactScope,
        provider: "powerotp_email",
        destination: "person@example.com",
        providerOperationId,
        proof: "123456",
      }).success,
      true,
    );
    assert.equal(
      HostedAuthPhoneProofRequestSchema.safeParse({
        authRequestId,
        scope: powerOtpSignupContactScope,
        provider: "powerotp_email",
        destination: "+15551234567",
        providerOperationId,
        proof: "123456",
      }).success,
      false,
    );
    assert.equal(
      HostedAuthPhoneProofRequestSchema.safeParse({
        authRequestId,
        scope: diditSigninContactScope,
        provider: "didit_phone",
        providerOperationId,
        proof: "123456",
      }).success,
      false,
    );
  });

  it("strictly rejects undeclared provider fields", () => {
    assert.equal(
      HostedAuthEmailChallengeRequestSchema.safeParse({
        authRequestId,
        scope: powerOtpSignupContactScope,
        provider: "powerotp_email",
        destination: "person@example.com",
        apiKey: "must-not-enter-contracts",
      }).success,
      false,
    );
  });
});

describe("hosted-auth Didit interface", () => {
  it("binds permanent user creation to the private POWEROTP mapping", () => {
    assert.equal(
      HostedAuthDiditUserRequestSchema.safeParse({
        hostedPersonIdentityId: personId,
        potpDiditId,
      }).success,
      true,
    );
    assert.equal(
      HostedAuthDiditUserResultSchema.safeParse({
        potpDiditId,
        diditInternalId,
      }).success,
      true,
    );
    assert.equal(
      HostedAuthDiditUserResultSchema.safeParse({
        potpDiditId,
        diditInternalId,
        providerUser: { raw: true },
      }).success,
      false,
    );
  });

  it("uses normalized purpose-scoped operations without provider SDK payloads", () => {
    const scope = HostedAuthVerificationScopeSchema.parse({
      projectId,
      realm: hostedAuthRealms.powerotp_pii,
      flow: "signup",
      providerPurpose: "age_assurance",
    });
    assert.equal(
      HostedAuthDiditVerificationRequestSchema.safeParse({
        authRequestId,
        scope,
        potpDiditId,
        diditInternalId,
      }).success,
      true,
    );
    assert.equal(
      HostedAuthDiditDecisionSchema.safeParse({
        authRequestId,
        scope,
        providerOperationId,
        status: "satisfied",
        minimalEvidenceReference: "evidence_reference_0001",
      }).success,
      true,
    );
    assert.equal(
      HostedAuthDiditDecisionSchema.safeParse({
        authRequestId,
        scope,
        providerOperationId,
        status: "satisfied",
        minimalEvidenceReference: "evidence_reference_0001",
        document: { raw: true },
      }).success,
      false,
    );
  });
});

describe("hosted-auth balance operation contract", () => {
  it("debits the exact project before a custody-compatible contact operation", () => {
    const request = {
      authRequestId,
      projectId,
      scope: powerOtpSignupContactScope,
      method: "powerotp_email",
      amountUsd: "0.001",
      action: "debit_before_provider",
    };
    assert.equal(
      HostedAuthBalanceOperationRequestSchema.safeParse(request).success,
      true,
    );
    assert.equal(
      HostedAuthBalanceOperationRequestSchema.safeParse({
        ...request,
        method: "didit_email",
      }).success,
      false,
    );
    assert.equal(
      HostedAuthBalanceOperationRequestSchema.safeParse({
        ...request,
        projectId: otherProjectId,
      }).success,
      false,
    );
    assert.equal(
      HostedAuthBalanceOperationRequestSchema.safeParse({
        ...request,
        amountUsd: "0",
      }).success,
      false,
    );
  });

  it("binds Didit charges to the exact verification purpose", () => {
    const scope = HostedAuthVerificationScopeSchema.parse({
      projectId,
      realm: hostedAuthRealms.powerotp_pii,
      flow: "signin",
      providerPurpose: "fresh_biometric_authentication",
    });
    const request = {
      authRequestId,
      projectId,
      scope,
      method: "didit_biometric_authentication",
      amountUsd: "0.25",
      action: "debit_before_provider",
    };
    assert.equal(
      HostedAuthBalanceOperationRequestSchema.safeParse(request).success,
      true,
    );
    assert.equal(
      HostedAuthBalanceOperationRequestSchema.safeParse({
        ...request,
        method: "didit_age",
      }).success,
      false,
    );
  });

  it("returns only a linked debit or insufficient-balance outcome", () => {
    assert.equal(
      HostedAuthBalanceOperationResultSchema.safeParse({
        authRequestId,
        projectId,
        scope: powerOtpSignupContactScope,
        method: "powerotp_email",
        status: "debited",
        balanceTransactionId: "balance_transaction_0001",
      }).success,
      true,
    );
    assert.equal(
      HostedAuthBalanceOperationResultSchema.safeParse({
        authRequestId,
        projectId,
        scope: powerOtpSignupContactScope,
        method: "powerotp_email",
        status: "insufficient_balance",
        providerOperationId,
      }).success,
      false,
    );
  });
});
