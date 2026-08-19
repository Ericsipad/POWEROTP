/**
 * Browser-safe entry point for `@powerotp/contracts`.
 *
 * Any module reachable from a customer-facing browser bundle — the BotBlocker
 * widget sensor/controller (`@powerotp/gate-core`), its browser coordinator
 * (`@powerotp/gate-node/browser`), and any framework client component that
 * imports either — must import from `@powerotp/contracts/browser`, never the
 * root `.` export. The root export's `index.ts` barrel re-exports every
 * contracts file, including backend-only Mongo persistence document schemas
 * and admin control-plane contracts; bundlers have repeatedly failed to
 * fully tree-shake unused named exports out of that single large barrel
 * (`export *` re-export chains defeat per-export dead-code elimination in
 * both webpack/Turbopack), so anything reachable from the root export can
 * end up textually present in a shipped client bundle regardless of what
 * that bundle actually references. See the dated 2026-08-18 entry in
 * `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md` for the incident that first
 * surfaced this and the resolution this file is part of.
 *
 * This barrel re-exports only the closed set of files that contain zero
 * backend-only structure: the BotBlocker wire protocol, browser-evidence,
 * decision, and behavior-report contracts (`botblocker.ts`); the browser
 * proof-evidence and advisory-snapshot contracts (`botblocker-browser.ts`);
 * the unsigned/signed site-clearance wire shapes (`botblocker-clearance.ts`);
 * the Passport/PaidTokenPass/risk-event proof shapes
 * (`botblocker-proofs.ts`); the Ed25519 signature/artifact wire shapes and
 * canonicalization helper, never private key material
 * (`botblocker-signing.ts`); and the FingerprintJS vector/component contracts
 * (`fingerprint.ts`, `fingerprint-components.ts`).
 *
 * Before adding a new export here, confirm the source file contains no
 * MongoDB document schema, HMAC secret, admin/control-plane contract, or
 * other server-only structure — and add it to
 * `libraries/gate-node/src/browser.test.ts` or
 * `backend/packages/contracts/src/index.browser.test.ts`'s guard list if it
 * is a name a future backend-only file might plausibly reuse.
 */
export * from "./botblocker.js";
export * from "./botblocker-browser.js";
export * from "./botblocker-clearance.js";
export * from "./botblocker-proofs.js";
export * from "./botblocker-signing.js";
export * from "./fingerprint.js";
export * from "./fingerprint-components.js";
