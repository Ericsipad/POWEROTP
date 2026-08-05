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
