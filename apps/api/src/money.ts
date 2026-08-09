/**
 * Money is stored as plain JS floats (dollars), the same convention already
 * used by `VerificationRequestDocument#providerRecord.providerCostUsd` —
 * rounded to 6 decimal places (enough to preserve real VoIP.ms-scale
 * fractional-cent values like `$0.0009`) to avoid floating-point drift from
 * repeated addition across a long-running ledger.
 */
export function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
