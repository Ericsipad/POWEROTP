import { z } from "zod";

import { SiteIdSchema } from "./botblocker.js";

/**
 * BotBlocker challenge lifecycle contracts (Phase 2 of
 * `docs/POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`). A BotBlocker challenge
 * is the bot-detection interaction served when an `otp` decision opens the
 * hosted iframe (see `docs/POWEROTP_BOTBLOCKER_PLAN.md`'s "Browser Gate
 * Shell and Runtime Sensor" section) — it is NOT the OTP `ChallengeSchema`
 * in `verification.ts` (a phone-verification "select what you heard"
 * challenge). The two stay separate schemas; only the option-count/
 * selection-bound *conventions* (min 2 options, a single-answer challenge
 * must require exactly one selection) are genuinely shared UX invariants,
 * so they are mirrored here deliberately, not reused by import — reusing
 * the OTP type directly would conflate two different concepts. No
 * orchestration, scoring, or persistence exists yet (Phase 8/16/17); this
 * file fixes only the wire shape and pure lifecycle-transition/expiry
 * logic, mirroring `botblocker.ts`'s `isStaleSequence` pattern.
 */

export const botBlockerChallengeStates = [
  "pending",
  "presented",
  "completed",
  "expired",
  "canceled",
] as const;
export const BotBlockerChallengeStateSchema = z.enum(botBlockerChallengeStates);

export const terminalBotBlockerChallengeStates = ["completed", "expired", "canceled"] as const;
export const TerminalBotBlockerChallengeStateSchema = z.enum(terminalBotBlockerChallengeStates);

export const BotBlockerChallengeOptionSchema = z
  .object({
    id: z.string().min(16),
    label: z.string().min(1).max(2_000),
  })
  .strict();

/**
 * The full challenge shape returned to an adapter/browser. Never carries a
 * correct-answer indicator — mirroring `ChallengeDefinitionSchema` in
 * `challenges.ts`, correct answers stay off every response surface.
 */
export const BotBlockerChallengeSchema = z
  .object({
    challengeId: z.string().min(16),
    gateSessionId: z.string().min(16),
    siteId: SiteIdSchema,
    state: BotBlockerChallengeStateSchema,
    prompt: z.string().min(1).max(4_000),
    options: z.array(BotBlockerChallengeOptionSchema).min(2).max(100),
    allowsMultiple: z.boolean(),
    minSelections: z.number().int().positive(),
    maxSelections: z.number().int().positive(),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((challenge, context) => {
    if (challenge.minSelections > challenge.maxSelections) {
      context.addIssue({
        code: "custom",
        message: "minSelections cannot exceed maxSelections",
        path: ["minSelections"],
      });
    }
    if (challenge.maxSelections > challenge.options.length) {
      context.addIssue({
        code: "custom",
        message: "maxSelections cannot exceed the number of options",
        path: ["maxSelections"],
      });
    }
    if (!challenge.allowsMultiple && challenge.maxSelections !== 1) {
      context.addIssue({
        code: "custom",
        message: "Single-answer challenges must allow exactly one selection",
        path: ["maxSelections"],
      });
    }
    if (challenge.expiresAt <= challenge.issuedAt) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must be after issuedAt",
        path: ["expiresAt"],
      });
    }
  });

/**
 * What a caller submits to complete a challenge. Deliberately carries no
 * `passed`/`verified`/`outcome` field — whether a challenge was passed is
 * an authoritative server determination (Phase 16/17), never something a
 * browser-supplied submission can declare for itself; `.strict()` rejects
 * any attempt to add one at parse time — see
 * `botblocker-challenge.test.ts`'s reject-by-construction test.
 */
export const BotBlockerChallengeCompletionSchema = z
  .object({
    challengeId: z.string().min(16),
    selectedOptionIds: z.array(z.string().min(16)).min(1).max(100),
  })
  .strict();

const allowedBotBlockerChallengeTransitions: Record<
  BotBlockerChallengeState,
  readonly BotBlockerChallengeState[]
> = {
  pending: ["presented", "expired", "canceled"],
  presented: ["completed", "expired", "canceled"],
  completed: [],
  expired: [],
  canceled: [],
};

/**
 * Pure lifecycle-transition check, mirroring `botblocker.ts`'s
 * `isStaleSequence` pattern: the comparison is defined and tested exactly
 * once here, with no storage backing it yet (persistence is Phase 6).
 */
export function isValidBotBlockerChallengeTransition(
  from: BotBlockerChallengeState,
  to: BotBlockerChallengeState,
): boolean {
  return allowedBotBlockerChallengeTransitions[from].includes(to);
}

export function isBotBlockerChallengeExpired(
  challenge: Pick<BotBlockerChallenge, "expiresAt">,
  now: number,
): boolean {
  return now >= challenge.expiresAt;
}

export type BotBlockerChallengeState = z.infer<typeof BotBlockerChallengeStateSchema>;
export type TerminalBotBlockerChallengeState = z.infer<
  typeof TerminalBotBlockerChallengeStateSchema
>;
export type BotBlockerChallengeOption = z.infer<typeof BotBlockerChallengeOptionSchema>;
export type BotBlockerChallenge = z.infer<typeof BotBlockerChallengeSchema>;
export type BotBlockerChallengeCompletion = z.infer<typeof BotBlockerChallengeCompletionSchema>;
