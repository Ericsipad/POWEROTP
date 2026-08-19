import { z } from "zod";

import {
  HoneypotActivationSchema,
  SiteIdSchema,
} from "./botblocker.js";

/**
 * BotBlocker Passport/PaidTokenPass assertion and risk-event contracts
 * (Phase 2 of `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`). Proof
 * shapes only — no issuance, verification, scoring, or persistence logic
 * (Passport issuance is Phase 21+, PaidTokenPass issuance is Phase 23,
 * risk-event ingestion/scoring is Phase 15/17). Every shape here is
 * something a caller *presents* or *submits*; none of them can be used to
 * fabricate a "verified"/authoritative outcome, because every object is
 * `.strict()` — a browser-supplied `verified`, `passed`, `score`, or
 * `decision` field is rejected at parse time, not silently ignored. See
 * `botblocker-proofs.test.ts`'s reject-by-construction tests and
 * `docs/THREAT_MODEL.md`'s "Iframe / postMessage authority" section.
 */

// ---------------------------------------------------------------------------
// Passport assertion (proof shape only)
// ---------------------------------------------------------------------------

/**
 * A pairwise, per-site Passport assertion presented to a customer site.
 * `pairwiseSubjectId` is the already-derived `HMAC(pepper, user_id ||
 * client_id)` pseudonym described in
 * `docs/PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` — this contract never carries
 * a cross-site or network-global identifier, and never carries a
 * self-declared "verified" claim; whether an assertion is authoritative is
 * a server-side determination this proof shape does not make for itself.
 */
export const PassportAssertionSchema = z
  .object({
    assertionId: z.string().min(16),
    siteId: SiteIdSchema,
    pairwiseSubjectId: z.string().min(16),
    audience: z.string().min(1),
    nonce: z.string().min(16),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

// ---------------------------------------------------------------------------
// PaidTokenPass assertion (proof shape only)
// ---------------------------------------------------------------------------

export const paidTokenPassScopes = ["one_time", "all_sites"] as const;
export const PaidTokenPassScopeSchema = z.enum(paidTokenPassScopes);

/**
 * A proof-of-possession machine credential (see
 * `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s "Tokens and cookies" section:
 * "Agent entitlement: separate proof-of-possession machine credential").
 * Quota/expiry/revocation enforcement and issuance are Phase 23; this is
 * only the shape presented when asserting an already-issued pass.
 */
export const PaidTokenPassAssertionSchema = z
  .object({
    assertionId: z.string().min(16),
    siteId: SiteIdSchema,
    passId: z.string().min(16),
    scope: PaidTokenPassScopeSchema,
    audience: z.string().min(1),
    nonce: z.string().min(16),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Risk-event batch (shape only — no scoring, no persistence)
// ---------------------------------------------------------------------------

export const riskEventKinds = [
  "honeypot_activation",
  "automation_indicator",
  "velocity_anomaly",
  "challenge_failure",
] as const;
export const RiskEventKindSchema = z.enum(riskEventKinds);

/**
 * One sanitized risk-signal observation submitted within the canonical
 * `POST /v1/botblocker/reports/{webhookId}` body.
 * Deliberately carries no score/weight/decision field — those are computed
 * centrally (Phase 17), never submitted by the browser/adapter that is
 * being evaluated. `honeypot` reuses `botblocker.ts`'s
 * `HoneypotActivationSchema` rather than duplicating it, exactly as the
 * sanitized-telemetry table in `docs/THREAT_MODEL.md` requires.
 */
export const RiskEventSchema = z
  .object({
    kind: RiskEventKindSchema,
    occurredAt: z.number().int().positive(),
    honeypot: HoneypotActivationSchema.optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.kind === "honeypot_activation" && !event.honeypot) {
      context.addIssue({
        code: "custom",
        message: "honeypot_activation requires a honeypot field",
        path: ["honeypot"],
      });
    }
  });

export type PassportAssertion = z.infer<typeof PassportAssertionSchema>;
export type PaidTokenPassScope = z.infer<typeof PaidTokenPassScopeSchema>;
export type PaidTokenPassAssertion = z.infer<typeof PaidTokenPassAssertionSchema>;
export type RiskEventKind = z.infer<typeof RiskEventKindSchema>;
export type RiskEvent = z.infer<typeof RiskEventSchema>;
