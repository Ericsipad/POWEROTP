import type { ProjectIdentityBindingRepository } from "./hosted-auth-durable-repository.js";
import type {
  HostedAuthDeletionCandidate,
  HostedAuthDeletionEvidenceDisposition,
  HostedAuthIdentityDeletionRepository,
} from "./hosted-auth-identity-deletion-contracts.js";
import type { HostedAuthIdentityCryptoShredder } from "./hosted-auth-identity-crypto-shredding.js";

export const HOSTED_AUTH_DELETION_LEASE_MS = 15 * 60 * 1_000;

export interface HostedAuthProviderIdentityCleanup {
  deleteIdentityArtifacts(input: {
    hostedPersonIdentityId: string;
    providerIdentityReferences: readonly string[];
    providerContactReferences: readonly string[];
  }): Promise<"confirmed" | "already_absent">;
}

export interface HostedAuthRuntimeIdentityCleanup {
  purgeForIdentity(hostedPersonIdentityId: string): Promise<void>;
}

export type HostedAuthIdentityDeletionResult = Readonly<{
  hostedPersonIdentityId: string;
  action: "completed" | "failed";
  reason?: string;
}>;

type EvidencePolicy = (
  hostedPersonIdentityId: string,
) => Promise<HostedAuthDeletionEvidenceDisposition>;

export class HostedAuthIdentityDeletionOrchestrator {
  constructor(
    private readonly identities: HostedAuthIdentityDeletionRepository,
    private readonly runtime: HostedAuthRuntimeIdentityCleanup,
    private readonly provider: HostedAuthProviderIdentityCleanup,
    private readonly bindings: Pick<
      ProjectIdentityBindingRepository,
      "markDeletedForPerson"
    >,
    private readonly evidencePolicy: EvidencePolicy,
    private readonly cryptoShredder: Pick<
      HostedAuthIdentityCryptoShredder,
      "shred"
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  schedule(input: {
    hostedPersonIdentityId: string;
    eligibleAt: Date;
  }): Promise<"scheduled" | "duplicate" | "completed"> {
    return this.identities.schedule({
      ...input,
      requestedAt: this.now(),
    });
  }

  scheduleAbandonedProviderIdentity(
    hostedPersonIdentityId: string,
  ): Promise<"scheduled" | "duplicate" | "completed"> {
    return this.identities.scheduleAbandonedProviderIdentity({
      hostedPersonIdentityId,
      requestedAt: this.now(),
    });
  }

  async runOnce(
    limit = 100,
  ): Promise<readonly HostedAuthIdentityDeletionResult[]> {
    const claimedAt = this.now();
    const claimed = await this.identities.claimEligible({
      now: claimedAt,
      leaseExpiredBefore: new Date(
        claimedAt.getTime() - HOSTED_AUTH_DELETION_LEASE_MS,
      ),
      limit,
    });
    const results: HostedAuthIdentityDeletionResult[] = [];
    for (const candidate of claimed) {
      try {
        await this.deleteCandidate(candidate, claimedAt);
        results.push({
          hostedPersonIdentityId: candidate.hostedPersonIdentityId,
          action: "completed",
        });
      } catch {
        results.push({
          hostedPersonIdentityId: candidate.hostedPersonIdentityId,
          action: "failed",
          reason: "identity_deletion_failed",
        });
      }
    }
    return results;
  }

  private async deleteCandidate(
    candidate: HostedAuthDeletionCandidate,
    completedAt: Date,
  ): Promise<void> {
    await this.runtime.purgeForIdentity(candidate.hostedPersonIdentityId);
    const hasProviderArtifacts =
      candidate.providerIdentityReferences.length > 0 ||
      candidate.providerContactReferences.length > 0;
    if (hasProviderArtifacts) {
      await this.provider.deleteIdentityArtifacts(candidate);
    }
    const evidence = await this.evidencePolicy(
      candidate.hostedPersonIdentityId,
    );
    await this.cryptoShredder.shred({
      hostedPersonIdentityId: candidate.hostedPersonIdentityId,
      completedAt,
    });
    await this.bindings.markDeletedForPerson(
      candidate.hostedPersonIdentityId,
    );
    await this.identities.finalize({
      hostedPersonIdentityId: candidate.hostedPersonIdentityId,
      completedAt,
      providerCleanupConfirmed: hasProviderArtifacts,
      evidence,
    });
  }
}
