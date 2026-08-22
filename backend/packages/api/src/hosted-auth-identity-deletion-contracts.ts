export type HostedAuthDeletionCandidate = Readonly<{
  hostedPersonIdentityId: string;
  providerIdentityReferences: readonly string[];
  providerContactReferences: readonly string[];
}>;

export type HostedAuthDeletionEvidenceDisposition = Readonly<{
  retainConsentEvidence: boolean;
  retainVerificationEvidence: boolean;
}>;

export interface HostedAuthIdentityDeletionRepository {
  schedule(input: {
    hostedPersonIdentityId: string;
    requestedAt: Date;
    eligibleAt: Date;
  }): Promise<"scheduled" | "duplicate" | "completed">;
  scheduleAbandonedProviderIdentity(input: {
    hostedPersonIdentityId: string;
    requestedAt: Date;
  }): Promise<"scheduled" | "duplicate" | "completed">;
  claimEligible(input: {
    now: Date;
    leaseExpiredBefore: Date;
    limit: number;
  }): Promise<readonly HostedAuthDeletionCandidate[]>;
  finalize(input: {
    hostedPersonIdentityId: string;
    completedAt: Date;
    providerCleanupConfirmed: boolean;
    evidence: HostedAuthDeletionEvidenceDisposition;
  }): Promise<"completed" | "duplicate">;
}
