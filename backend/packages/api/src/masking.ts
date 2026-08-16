import type { VerificationType } from "@powerotp/contracts";

/**
 * Masks an E.164 phone number for display, keeping the leading `+` and last
 * two digits so operators can still distinguish destinations without
 * exposing the full number in dashboards, logs, or callbacks.
 */
export function maskE164(targetNumber: string) {
  const digits = targetNumber.replace(/^\+/, "");
  if (digits.length <= 2) return `+${"•".repeat(digits.length)}`;
  const visible = digits.slice(-2);
  return `+${"•".repeat(digits.length - 2)}${visible}`;
}

/**
 * Masks an email address for display, keeping the first character of the
 * local part and the whole domain — enough to distinguish destinations
 * without exposing the full address.
 */
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•".repeat(email.length);
  const visible = local.slice(0, 1);
  return `${visible}${"•".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

/** Branches on type since `email_code`'s target is an email address, not
 * an E.164 number — every other type still masks the same way as before. */
export function maskTarget(type: VerificationType, target: string) {
  return type === "email_code" ? maskEmail(target) : maskE164(target);
}
