import type {
  CreateVerification,
  VerificationState,
  VerificationStatus,
  VerificationType,
} from "@powerotp/contracts";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";

import type { ChallengeService } from "./challenge-service.js";
import type { ProductionConfig } from "./config.js";
import type { ProjectDocument } from "./persistence.js";
import { verificationStatusUrl } from "./public-urls.js";
import {
  createFiveDigitCode,
  createSortableId,
  decryptString,
  encryptString,
  safeEqual,
} from "./security.js";
import {
  hasReachedAwaitingResponse,
  initialVerificationState,
  isTerminalState,
  isTransitionAllowed,
} from "./verification-state-machine.js";
import {
  idempotencyRecordId,
  type CallbackDeliveryDocument,
  type IdempotencyRecordDocument,
  type ProviderRecordSnapshot,
  type VerificationEventDocument,
  type VerificationRequestDocument,
} from "./verification-persistence.js";
import {
  computePlatformStats,
  computeProjectStats,
  listProjectInteractions,
  listProjectWidgetInteractions,
  listRecentCallbackDeliveries,
  listRecentWidgetInteractions,
} from "./verification-reporting.js";

const VERIFICATION_LIFETIME_MS = 10 * 60 * 1_000;

export class VerificationError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

export interface EnqueueDispatch {
  (interactionId: string): Promise<void>;
}

export interface EnqueueTimeout {
  (interactionId: string, delayMs: number): Promise<void>;
}

export interface EnqueueCallback {
  (interactionId: string, eventId: string): Promise<void>;
}

export interface EnqueueProviderReconcile {
  (interactionId: string): Promise<void>;
}

/** See `backend/packages/api/src/balance-service.ts#requireNonNegativeBalance` — kept
 * as a plain injected function (like the `enqueue*` callbacks above) so
 * this module never depends directly on the billing module. */
export interface RequireNonNegativeBalance {
  (customerId: string): Promise<void>;
}

/** See `backend/packages/api/src/usage-quota-service.ts#tryConsumeFreeQuota` — checked
 * before `RequireNonNegativeBalance`; a covered request never touches the
 * balance gate at all. Kept as a plain injected function for the same
 * reason as `RequireNonNegativeBalance` above. */
export interface TryConsumeFreeQuota {
  (customerId: string, type: VerificationType): Promise<boolean>;
}

/** See `backend/packages/api/src/auth-service.ts#requireVerifiedEmail`. */
export interface RequireVerifiedEmail {
  (customerId: string): Promise<void>;
}

/** See `backend/packages/api/src/billing-charge-service.ts#chargeCompletedInteraction`. */
export interface ChargeCompletedInteraction {
  (interaction: VerificationRequestDocument): Promise<void>;
}

export class VerificationService {
  readonly #requests;
  readonly #events;
  readonly #idempotency;
  readonly #callbackDeliveries;
  readonly #projects;

  constructor(
    db: Db,
    private readonly config: Pick<ProductionConfig, "PUBLIC_API_URL" | "CONFIG_ENCRYPTION_KEY">,
    private readonly challenges: ChallengeService,
    private readonly enqueueDispatch: EnqueueDispatch,
    private readonly enqueueTimeout: EnqueueTimeout,
    private readonly enqueueCallback: EnqueueCallback,
    private readonly enqueueProviderReconcile: EnqueueProviderReconcile,
    private readonly requireNonNegativeBalance: RequireNonNegativeBalance = async () => {},
    private readonly chargeCompletedInteraction: ChargeCompletedInteraction = async () => {},
    private readonly tryConsumeFreeQuota: TryConsumeFreeQuota = async () => false,
    private readonly requireVerifiedEmail: RequireVerifiedEmail = async () => {},
  ) {
    this.#requests = db.collection<VerificationRequestDocument>("verificationRequests");
    this.#events = db.collection<VerificationEventDocument>("verificationEvents");
    this.#idempotency = db.collection<IdempotencyRecordDocument>("idempotencyRecords");
    this.#callbackDeliveries = db.collection<CallbackDeliveryDocument>("callbackDeliveries");
    this.#projects = db.collection<ProjectDocument>("projects");
  }

  async create(
    projectId: string,
    customerId: string,
    input: CreateVerification,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const requestHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("base64url");
    const recordId = idempotencyRecordId(projectId, idempotencyKey);

    const existing = await this.#idempotency.findOne({ _id: recordId });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new VerificationError("idempotency_key_conflict", 409);
      }
      const verification = await this.#requests.findOne({ _id: existing.interactionId });
      if (verification) return this.#toAccepted(verification);
    }

    // An unverified account cannot create anything at all — closes a real
    // abuse gap where the free monthly quota below could otherwise be spent
    // purely by holding the API key shown once at signup, without ever
    // clicking the activation link. See
    // `backend/packages/api/src/auth-service.ts#requireVerifiedEmail`.
    await this.requireVerifiedEmail(customerId);

    // A new account's free monthly usage counter (see
    // `backend/packages/api/src/usage-quota-service.ts`) is checked first — a covered
    // request never touches the balance gate at all. Only once quota is
    // unavailable (none configured for this type, already used up this
    // window, or the account's 180-day free-quota eligibility has passed)
    // does the hard `balance <= 0` gate apply — see
    // `backend/packages/api/src/balance-service.ts#requireNonNegativeBalance`. Both
    // exempt the platform-admin-owned demo project.
    const coveredByFreeQuota = await this.tryConsumeFreeQuota(customerId, input.type);
    if (!coveredByFreeQuota) {
      await this.requireNonNegativeBalance(customerId);
    }

    // Voice clients may supply their own code; SMS/email codes are always
    // generated by the platform. All three use the same encrypted-at-rest
    // representation.
    const code =
      input.type === "voice_code"
        ? input.code ?? createFiveDigitCode()
        : input.type === "sms_code" || input.type === "email_code"
          ? createFiveDigitCode()
          : undefined;

    // A per-interaction snapshot of the owning project's branding, taken
    // once here rather than re-read at dispatch/delivery time — see
    // `VerificationRequestDocument#emailBranding`'s doc comment for why.
    const emailBranding =
      input.type === "email_code"
        ? await this.#projects.findOne(
            { _id: projectId },
            { projection: { brandName: 1, brandLogoUrl: 1, brandReplyToEmail: 1, brandHtmlTemplate: 1 } },
          )
        : undefined;

    // A missing challenge is a content-catalog precondition (nothing the
    // admin has published yet), not an infrastructure credential — unlike
    // an unconfigured trunk, which every other method only discovers
    // asynchronously at dispatch, this fails the request synchronously,
    // the same way an unsupported method or bad E.164 number already does.
    const challenge =
      input.type === "voice_challenge" ? await this.challenges.selectAndMaterialize() : undefined;
    if (input.type === "voice_challenge" && !challenge) {
      throw new VerificationError("no_published_challenges", 409);
    }

    const now = new Date();
    const verification: VerificationRequestDocument = {
      _id: createSortableId("int"),
      projectId,
      customerId,
      type: input.type,
      targetNumber: input.targetNumber,
      state: initialVerificationState,
      sequence: 0,
      correlationId,
      browserResponse: input.browserResponse,
      expectedCodeEncrypted: code
        ? encryptString(code, this.config.CONFIG_ENCRYPTION_KEY)
        : undefined,
      challenge,
      emailBranding: emailBranding
        ? {
            brandName: emailBranding.brandName,
            brandLogoUrl: emailBranding.brandLogoUrl,
            brandReplyToEmail: emailBranding.brandReplyToEmail,
            brandHtmlTemplate: emailBranding.brandHtmlTemplate,
          }
        : undefined,
      freeQuotaCovered: coveredByFreeQuota,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + VERIFICATION_LIFETIME_MS),
    };

    await this.#requests.insertOne(verification);

    try {
      await this.#idempotency.insertOne({
        _id: recordId,
        projectId,
        idempotencyKey,
        requestHash,
        interactionId: verification._id,
        createdAt: now,
      });
    } catch {
      // A concurrent request already created the interaction for this key.
      const winner = await this.#idempotency.findOne({ _id: recordId });
      if (winner) {
        await this.#requests.deleteOne({ _id: verification._id });
        const winningVerification = await this.#requests.findOne({
          _id: winner.interactionId,
        });
        if (winningVerification) return this.#toAccepted(winningVerification);
      }
    }

    await this.#writeEvent(verification, initialVerificationState);
    await this.enqueueDispatch(verification._id);
    await this.enqueueTimeout(verification._id, VERIFICATION_LIFETIME_MS);

    return this.#toAccepted(verification);
  }

  async get(interactionId: string): Promise<VerificationRequestDocument | null> {
    return this.#requests.findOne({ _id: interactionId });
  }

  toStatus(verification: VerificationRequestDocument): VerificationStatus {
    return {
      interactionId: verification._id,
      type: verification.type,
      state: verification.state,
      reasonCode: verification.reasonCode,
      createdAt: verification.createdAt.toISOString(),
      expiresAt: verification.expiresAt.toISOString(),
      challenge:
        verification.challenge &&
        hasReachedAwaitingResponse(verification.type, verification.state)
          ? {
              challengeId: verification.challenge.challengeDefinitionId,
              question: verification.challenge.question,
              options: verification.challenge.options,
              allowsMultiple: verification.challenge.allowsMultiple,
              minSelections: verification.challenge.minSelections,
              maxSelections: verification.challenge.maxSelections,
              expiresAt: verification.expiresAt.toISOString(),
            }
          : undefined,
    };
  }

  /**
   * The single shared transition function used by every transport and by
   * response submission. Guards against stale/invalid transitions with an
   * atomic conditional update, writes the append-only event before any
   * derived counter or callback, then enqueues the callback delivery.
   */
  async transition(
    interactionId: string,
    to: VerificationState,
    reasonCode?: string,
  ): Promise<boolean> {
    const current = await this.#requests.findOne({ _id: interactionId });
    if (!current) return false;
    if (current.billingPendingAt && !current.billingAppliedAt) {
      await this.chargeCompletedInteraction(current);
    }
    if (current.expiresAt.getTime() < Date.now() && !isTerminalState(current.state)) {
      to = "expired";
      reasonCode = "interaction_expired";
    }
    if (!isTransitionAllowed(current.type, current.state, to)) return false;

    const nextSequence = current.sequence + 1;
    const billingPending =
      !hasReachedAwaitingResponse(current.type, current.state) &&
      hasReachedAwaitingResponse(current.type, to) &&
      Boolean(current.callTrunkId || current.smsDid || current.emailSent);
    const updated = await this.#requests.findOneAndUpdate(
      { _id: interactionId, state: current.state, sequence: current.sequence },
      {
        $set: {
          state: to,
          reasonCode,
          sequence: nextSequence,
          updatedAt: new Date(),
          ...(billingPending ? { billingPendingAt: new Date() } : {}),
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) return false;

    await this.#recordTransition(updated, to, reasonCode);

    // The exact moment a call/SMS delivery attempt is fully finished
    // (whether or not the customer ever completes a follow-up code/
    // challenge submission) is the first time this interaction's state
    // crosses into "awaiting a response" (or a terminal state reached
    // directly, e.g. `call_reachability`, which has no awaiting_response
    // state at all) — never re-fires for a later succeeded/failed caused
    // by the customer's own code submission, since by then
    // `hasReachedAwaitingResponse(current.state)` is already true. Only
    // schedule reconciliation if a real trunk/DID was actually used —
    // nothing to look up for a `method_not_available` failure that never
    // reached a node or the SMS provider at all.
    const justFinishedDelivery =
      !hasReachedAwaitingResponse(current.type, current.state) &&
      hasReachedAwaitingResponse(updated.type, updated.state);
    if (justFinishedDelivery && (updated.callTrunkId || updated.smsDid || updated.emailSent)) {
      if (updated.callTrunkId || updated.smsDid) {
        await this.#requests.updateOne(
          { _id: updated._id },
          { $set: { providerRecordStatus: "pending" } },
        );
        await this.enqueueProviderReconcile(updated._id);
      }
      // Charge the customer's balance for this real, completed delivery
      // attempt at the same moment — see
      // `backend/packages/api/src/billing-charge-service.ts#chargeCompletedInteraction`.
      // Deliberately not gated on success/failure: a busy/no-answer call
      // still bills $0 (no `answered` event ever recorded), but a real SMS
      // send that VoIP.ms accepted is billed regardless of confirmed
      // delivery, matching real incurred provider cost either way.
      await this.chargeCompletedInteraction(updated);
    }

    return true;
  }

  /**
   * Records which trunk/DID actually carried out a delivery attempt,
   * ahead of the state transition that will decide whether to schedule
   * billing reconciliation (see `transition()` above) — called from the
   * node job-events route (`callTrunkId`) and the SMS dispatch transport
   * (`smsDid`) once the provider has actually accepted/placed the attempt,
   * never before. Deliberately a plain metadata write, not a state-machine
   * transition: it can't fail a stale-state race the way `transition()`
   * can, since it never depends on the current `state`/`sequence`.
   */
  async recordProviderAttemptMeta(
    interactionId: string,
    meta: { callTrunkId?: string; smsDid?: string; emailSent?: boolean },
  ) {
    await this.#requests.updateOne({ _id: interactionId }, { $set: meta });
  }

  /**
   * Records the end user's own IP/User-Agent, captured directly from their
   * browser request to the hosted verification modal — see
   * `VerificationRequestDocument#endUserIp` for why this is never
   * populated for a customer-backend-created verification. Visibility/
   * audit only, same as `recordProviderAttemptMeta`: a plain metadata
   * write, never a state-machine transition.
   */
  async recordEndUserMeta(interactionId: string, meta: { endUserIp?: string; endUserUserAgent?: string }) {
    await this.#requests.updateOne({ _id: interactionId }, { $set: meta });
  }

  /** Called by `backend/packages/api/src/provider-reconcile-worker.ts` once a matching
   * VoIP.ms CDR/SMS record has been found. */
  async applyProviderRecord(interactionId: string, record: ProviderRecordSnapshot) {
    await this.#requests.updateOne(
      { _id: interactionId },
      { $set: { providerRecord: record, providerRecordStatus: "matched" } },
    );
  }

  /** Called once reconciliation gives up (`"not_found"`) or keeps failing
   * (`"error"`) — see `backend/packages/api/src/provider-reconcile-worker.ts`. */
  async applyProviderRecordStatus(interactionId: string, status: "not_found" | "error") {
    await this.#requests.updateOne(
      { _id: interactionId },
      { $set: { providerRecordStatus: status } },
    );
  }

  /**
   * Atomically hands the oldest still-`dispatching` interaction of `type`
   * to a telephony node so it can actually place the call over its
   * already-registered trunk. `dispatching -> calling` is the state
   * machine's normal next active state for every voice type, so this reuses
   * the same invariant `transition` enforces — it is just expressed as a
   * "claim any matching candidate" query instead of "advance this known
   * document" so concurrent nodes can never double-claim the same
   * interaction (MongoDB serializes concurrent `findOneAndUpdate`s against
   * the same document).
   */
  async claimNextForNode(type: VerificationType): Promise<VerificationRequestDocument | null> {
    const claimed = await this.#requests.findOneAndUpdate(
      { type, state: "dispatching", expiresAt: { $gt: new Date() } },
      { $set: { state: "calling", updatedAt: new Date() }, $inc: { sequence: 1 } },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    );
    if (!claimed) return null;

    await this.#recordTransition(claimed, "calling", "node_claimed");
    return claimed;
  }

  async #recordTransition(
    updated: VerificationRequestDocument,
    to: VerificationState,
    reasonCode?: string,
  ) {
    const event = await this.#writeEvent(updated, to, reasonCode);
    await this.enqueueCallback(updated._id, event._id);
  }

  async attachInteractionToken(interactionId: string, nonce: string) {
    await this.#requests.updateOne(
      { _id: interactionId },
      { $set: { interactionTokenNonce: nonce } },
    );
  }

  /**
   * Atomically marks a browser-issued interaction token as used. Returns
   * false if the nonce does not match or the token was already consumed,
   * which the caller must treat as a replay.
   */
  async consumeInteractionToken(interactionId: string, nonce: string) {
    const updated = await this.#requests.findOneAndUpdate(
      {
        _id: interactionId,
        interactionTokenNonce: nonce,
        interactionTokenConsumedAt: { $exists: false },
      },
      { $set: { interactionTokenConsumedAt: new Date() } },
    );
    return Boolean(updated);
  }

  /**
   * Exactly one response is accepted per interaction: `#requireActive`
   * rejects a second submission once the interaction is terminal, which
   * covers both replay and over-attempt cases from a single durable check.
   */
  async submitCode(interactionId: string, code: string) {
    const verification = await this.#requireActive(interactionId, [
      "voice_code",
      "sms_code",
      "email_code",
    ]);
    if (verification.state !== "awaiting_response") {
      throw new VerificationError("not_awaiting_response", 409);
    }

    const expectedCode = verification.expectedCodeEncrypted
      ? decryptString(verification.expectedCodeEncrypted, this.config.CONFIG_ENCRYPTION_KEY)
      : undefined;
    const correct = Boolean(expectedCode) && safeEqual(expectedCode!, code);
    const applied = await this.transition(
      interactionId,
      correct ? "succeeded" : "failed",
      correct ? "code_matched" : "code_mismatch",
    );
    if (!applied) throw new VerificationError("stale_verification_state", 409);
    return { succeeded: correct };
  }

  /**
   * Grades a `voice_challenge` response the same way `submitCode` grades a
   * code: exactly one accepted submission per interaction, no distinction
   * in the response between a wrong answer and a stale/expired one beyond
   * the existing terminal-state and transition guards.
   */
  async submitChallenge(interactionId: string, optionIds: string[]) {
    const verification = await this.#requireActive(interactionId, "voice_challenge");
    if (verification.state !== "awaiting_response") {
      throw new VerificationError("not_awaiting_response", 409);
    }
    if (!verification.challenge) {
      throw new VerificationError("challenge_not_available", 409);
    }

    const correct = this.challenges.gradeSubmission(
      verification.challenge.expectedAnswerOptionIdsEncrypted,
      optionIds,
    );
    const applied = await this.transition(
      interactionId,
      correct ? "succeeded" : "failed",
      correct ? "challenge_matched" : "challenge_mismatch",
    );
    if (!applied) throw new VerificationError("stale_verification_state", 409);
    return { succeeded: correct };
  }

  async cancel(interactionId: string, projectId: string) {
    const verification = await this.#requests.findOne({ _id: interactionId, projectId });
    if (!verification) throw new VerificationError("verification_not_found", 404);
    const applied = await this.transition(interactionId, "canceled", "customer_canceled");
    if (!applied) throw new VerificationError("verification_not_cancelable", 409);
  }

  /**
   * Decrypts a code only at its delivery boundary: either the authenticated
   * telephony node that speaks it or the in-process SMS provider adapter.
   */
  codeForDelivery(verification: VerificationRequestDocument): string | undefined {
    if (!verification.expectedCodeEncrypted) return undefined;
    return decryptString(verification.expectedCodeEncrypted, this.config.CONFIG_ENCRYPTION_KEY);
  }

  /**
   * The local sound basename a claiming node should already have synced
   * (see `apps/telephony-agent/src/media-sync.ts`) — never a Spaces key or
   * URL, since a node's ARI `sound:` media type resolves files by basename
   * from its own local media directory.
   */
  soundBasenameForDelivery(verification: VerificationRequestDocument): string | undefined {
    if (!verification.challenge) return undefined;
    return this.challenges.soundBasenameFor(verification.challenge.recordingAssetId);
  }

  async projectStats(projectId: string) {
    return computeProjectStats(this.#requests, projectId);
  }

  /** Admin-only, platform-wide totals — see `docs/AS_BUILT.md`'s "Admin
   * operator health dashboard" section. */
  async platformStats() {
    return computePlatformStats(this.#requests);
  }

  async listInteractions(projectId: string, limit = 50, type?: VerificationType) {
    return listProjectInteractions(this.#requests, projectId, limit, type);
  }

  /** Customer-facing equivalent of `recentWidgetInteractions` below, scoped
   * to one project — backs the dashboard's own "Visitors" tab. */
  async projectWidgetInteractions(projectId: string, limit = 50) {
    return listProjectWidgetInteractions(this.#requests, projectId, limit);
  }

  /** Admin-only visibility into recent callback delivery attempts — the
   * data is already recorded by `backend/packages/api/src/callback-worker.ts`. */
  async recentCallbackDeliveries(limit = 50) {
    return listRecentCallbackDeliveries(this.#callbackDeliveries, limit);
  }

  /** Admin-only visibility into recent real end-user widget interactions
   * (see `endUserIp`/`recordEndUserMeta` above) — visibility/audit only,
   * no fraud/risk logic attached to this yet. */
  async recentWidgetInteractions(limit = 50) {
    return listRecentWidgetInteractions(this.#requests, limit);
  }

  async #requireActive(
    interactionId: string,
    expectedTypes: VerificationType | readonly VerificationType[],
  ) {
    const verification = await this.#requests.findOne({ _id: interactionId });
    if (!verification) throw new VerificationError("verification_not_found", 404);
    const allowedTypes = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];
    if (!allowedTypes.includes(verification.type)) {
      throw new VerificationError("unsupported_response_type", 400);
    }
    if (isTerminalState(verification.state)) {
      throw new VerificationError("verification_already_resolved", 409);
    }
    return verification;
  }

  async #writeEvent(
    verification: VerificationRequestDocument,
    state: VerificationState,
    reasonCode?: string,
  ) {
    const event: VerificationEventDocument = {
      _id: createSortableId("evt"),
      interactionId: verification._id,
      projectId: verification.projectId,
      sequence: verification.sequence,
      type: verification.type,
      state,
      reasonCode,
      occurredAt: new Date(),
    };
    await this.#events.insertOne(event);
    return event;
  }

  #toAccepted(verification: VerificationRequestDocument) {
    return {
      interactionId: verification._id,
      state: initialVerificationState,
      statusUrl: verificationStatusUrl(this.config.PUBLIC_API_URL, verification._id),
      expiresAt: verification.expiresAt.toISOString(),
    };
  }
}
