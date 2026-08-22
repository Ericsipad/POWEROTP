import { hostedAuthRealms } from "@powerotp/contracts";

import {
  ProjectIdentityBindingRepository,
  WrappedIdentityKeyRepository,
} from "./hosted-auth-durable-repository.js";
import type {
  HostedAuthIdentityReconciliationRepository,
  PendingHostedIdentityArtifact,
  PendingHostedIdentityProfileArtifact,
} from "./hosted-auth-identity-reconciliation-repository.js";

export const HOSTED_AUTH_PENDING_RECONCILIATION_AGE_MS = 15 * 60 * 1_000;

export type HostedAuthIdentityReconciliationResult = Readonly<{
  hostedPersonIdentityId: string;
  action:
    | "retried"
    | "partial_identity_cleaned"
    | "orphan_key_cleaned"
    | "provider_cleanup_scheduled"
    | "skipped"
    | "failed";
  reason?: string;
}>;

type RetryPendingIdentity = (input: {
  hostedPersonIdentityId: string;
  hostedAuthProfileId: string;
  identityDataMode: "powerotp_pii" | "didit_pii";
}) => Promise<void>;

export class HostedAuthIdentityReconciliationWorker {
  constructor(
    private readonly identities: HostedAuthIdentityReconciliationRepository,
    private readonly keys: Pick<
      WrappedIdentityKeyRepository,
      "deleteActive" | "findActive" | "listActiveBefore"
    >,
    private readonly bindings: Pick<
      ProjectIdentityBindingRepository,
      "hasForPerson"
    >,
    private readonly retryPendingIdentity: RetryPendingIdentity,
    private readonly now: () => Date = () => new Date(),
    private readonly scheduleAbandonedProviderIdentity?: (
      hostedPersonIdentityId: string,
    ) => Promise<"scheduled" | "duplicate" | "completed">,
  ) {}

  async runOnce(
    limit = 100,
  ): Promise<readonly HostedAuthIdentityReconciliationResult[]> {
    const claimedAt = this.now();
    const staleBefore = new Date(
      claimedAt.getTime() - HOSTED_AUTH_PENDING_RECONCILIATION_AGE_MS,
    );
    const claimed = await this.identities.claimStalePending({
      staleBefore,
      claimedAt,
      limit,
    });
    const results: HostedAuthIdentityReconciliationResult[] = [];
    for (const hostedPersonIdentityId of claimed) {
      try {
        results.push(await this.reconcileIdentity(hostedPersonIdentityId));
      } catch {
        results.push({
          hostedPersonIdentityId,
          action: "failed",
          reason: "identity_reconciliation_failed",
        });
      }
    }

    let after:
      | Readonly<{ createdAt: Date; hostedPersonIdentityId: string }>
      | undefined;
    for (;;) {
      const page = await this.keys.listActiveBefore(staleBefore, limit, after);
      for (const key of page) {
        if (this.hasResult(results, key.hostedPersonIdentityId)) continue;
        try {
          if (await this.identities.personExists(key.hostedPersonIdentityId)) {
            continue;
          }
          if (await this.bindings.hasForPerson(key.hostedPersonIdentityId)) {
            results.push({
              hostedPersonIdentityId: key.hostedPersonIdentityId,
              action: "failed",
              reason: "orphan_key_has_binding",
            });
            continue;
          }
          await this.keys.deleteActive(key.hostedPersonIdentityId);
          results.push({
            hostedPersonIdentityId: key.hostedPersonIdentityId,
            action: "orphan_key_cleaned",
          });
        } catch {
          results.push({
            hostedPersonIdentityId: key.hostedPersonIdentityId,
            action: "failed",
            reason: "orphan_key_cleanup_failed",
          });
        }
      }
      const last = page.at(-1);
      if (!last || page.length < limit) break;
      after = {
        createdAt: last.createdAt,
        hostedPersonIdentityId: last.hostedPersonIdentityId,
      };
    }
    return results;
  }

  private async reconcileIdentity(
    hostedPersonIdentityId: string,
  ): Promise<HostedAuthIdentityReconciliationResult> {
    const artifact = await this.identities.inspect(hostedPersonIdentityId);
    if (!artifact || artifact.personStatus !== "pending") {
      return { hostedPersonIdentityId, action: "skipped" };
    }
    if (await this.bindings.hasForPerson(hostedPersonIdentityId)) {
      return {
        hostedPersonIdentityId,
        action: "failed",
        reason: "pending_identity_has_binding",
      };
    }

    const key = await this.keys.findActive(hostedPersonIdentityId);
    const profile = artifact.profiles.length === 1 ? artifact.profiles[0] : null;
    if (profile && isCompletePending(artifact, profile)) {
      if (profile.identityDataMode === "powerotp_pii" && !key) {
        return this.cleanPartial(artifact, "missing_wrapped_key");
      }
      if (profile.identityDataMode === "didit_pii" && key) {
        await this.keys.deleteActive(hostedPersonIdentityId);
      }
      await this.retryPendingIdentity({
        hostedPersonIdentityId,
        hostedAuthProfileId: profile.hostedAuthProfileId,
        identityDataMode: profile.identityDataMode,
      });
      return { hostedPersonIdentityId, action: "retried" };
    }

    if (hasProtectedDependents(artifact)) {
      return {
        hostedPersonIdentityId,
        action: "failed",
        reason: "partial_identity_has_dependent_artifacts",
      };
    }
    if (artifact.profiles.some(({ providerReferenceCount }) => providerReferenceCount > 0)) {
      if (this.scheduleAbandonedProviderIdentity) {
        await this.scheduleAbandonedProviderIdentity(hostedPersonIdentityId);
        return {
          hostedPersonIdentityId,
          action: "provider_cleanup_scheduled",
        };
      }
      return {
        hostedPersonIdentityId,
        action: "failed",
        reason: "provider_cleanup_required",
      };
    }
    return this.cleanPartial(artifact, "partial_identity");
  }

  private async cleanPartial(
    artifact: PendingHostedIdentityArtifact,
    reason: string,
  ): Promise<HostedAuthIdentityReconciliationResult> {
    const deleted = await this.identities.deletePending(
      artifact.hostedPersonIdentityId,
    );
    if (!deleted) {
      return {
        hostedPersonIdentityId: artifact.hostedPersonIdentityId,
        action: "skipped",
      };
    }
    await this.keys.deleteActive(artifact.hostedPersonIdentityId);
    return {
      hostedPersonIdentityId: artifact.hostedPersonIdentityId,
      action: "partial_identity_cleaned",
      reason,
    };
  }

  private hasResult(
    results: readonly HostedAuthIdentityReconciliationResult[],
    hostedPersonIdentityId: string,
  ): boolean {
    return results.some(
      (result) => result.hostedPersonIdentityId === hostedPersonIdentityId,
    );
  }
}

function isCompletePending(
  artifact: PendingHostedIdentityArtifact,
  profile: PendingHostedIdentityProfileArtifact,
): boolean {
  const expectedAttributes =
    profile.identityDataMode === "powerotp_pii" ? 1 : 0;
  return (
    artifact.personStatus === "pending" &&
    artifact.verificationCount === 0 &&
    profile.profileStatus === "pending" &&
    profile.contactStatus === "pending" &&
    profile.rpId === hostedAuthRealms[profile.identityDataMode].rpId &&
    profile.contactCount === 1 &&
    profile.encryptedAttributeCount === expectedAttributes &&
    profile.validCustodyContactCount === 1 &&
    profile.credentialCount === 0 &&
    profile.consentCount === 0
  );
}

function hasProtectedDependents(
  artifact: PendingHostedIdentityArtifact,
): boolean {
  return (
    artifact.verificationCount > 0 ||
    artifact.profiles.some(
      ({ credentialCount, consentCount }) =>
        credentialCount > 0 || consentCount > 0,
    )
  );
}
