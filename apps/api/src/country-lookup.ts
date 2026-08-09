import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Resolves the ISO 3166-1 alpha-2 country for a verification's own E.164
 * `targetNumber` — used to look up the admin-entered per-country call/SMS
 * rate card (see `docs/AS_BUILT.md`'s "Customer balance billing" section).
 * Uses `libphonenumber-js` (a real, maintained library covering every
 * country's real numbering plan) rather than a hand-rolled calling-code
 * prefix table, which would misattribute countries that share a calling
 * code (e.g. NANP's `+1`, shared by the US, Canada, and several Caribbean
 * nations). Returns `undefined` for a number the library can't parse — the
 * caller must treat that as "no rate available", never a guess.
 */
export function countryForE164(targetNumber: string): string | undefined {
  return parsePhoneNumberFromString(targetNumber)?.country;
}
