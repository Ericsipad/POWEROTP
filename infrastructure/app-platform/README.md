# DigitalOcean App Platform setup

Connect the same GitHub repository to two independently scalable App Platform
components. There is no App Spec YAML. Each component uses its own self-contained
source directory, manifest, lockfile, and dependencies.

## Repository selection

- Repository: `Ericsipad/POWEROTP`
- Branch: `main` for both production components. Feature branches are for review/test
  deployments only, not production deployment guidance.
- Auto-detected environment: Node.js

Configure the components exactly as follows:

- Frontend (`powerotp.com`): source `frontend`, build `npm run build`, run
  `npm start`, health check `/api/health`
- Backend (`api.powerotp.com`): source `backend`, build `npm run build`, run
  `npm start`, health check `/health`
- HTTP port: use App Platform's `PORT`; both Next.js processes read it automatically

Source directories are relative to the repository root and must not have a leading
slash. A backend build is correctly scoped only when its log begins with
`powerotp-backend@...`; `powerotp@...` means the component is still building from `/`.

## Two standalone components, one repository

`frontend` serves only the marketing site, dashboard, authentication pages, and hosted
widget. `backend/apps/server` serves every `/v1` route, `/mcp`, `/health`, and `/ready`, and is
the only process that connects to MongoDB/Valkey or starts BullMQ workers. `backend/packages/api`
and `backend/packages/mcp` are private packages contained entirely inside `/backend`.
The frontend has no dependency on them or on any root package.

Do not deploy `apps/telephony-agent` to App Platform. It belongs on each Asterisk droplet
in Phase 4.

## Required App Platform variables

Enter server secrets only on the backend component and mark every credential/key/secret
as an **encrypted** App Platform variable so values never appear in build/runtime logs.
The frontend receives only
`NEXT_PUBLIC_APP_URL=https://powerotp.com` and
`NEXT_PUBLIC_API_URL=https://api.powerotp.com`. Do not commit values or create a
repository `.env` file.

- `MONGODB_URI`: MongoDB Atlas TLS connection string
- `VALKEY_URL`: authenticated `rediss://` connection string
- `BOTBLOCKER_ED25519_ACTIVE_KEY_ID` /
  `BOTBLOCKER_ED25519_ACTIVE_PRIVATE_KEY_PKCS8_BASE64`: optional until BotBlocker is
  activated, but required together. The ID is 1–128 characters. The private key is an
  Ed25519 PKCS#8 DER object encoded as canonical base64 and remains server-only; it must
  be independent from every OTP HMAC, AES, password, API-key, and interaction-token
  secret.
- `BOTBLOCKER_ED25519_PREVIOUS_KEY_ID` /
  `BOTBLOCKER_ED25519_PREVIOUS_PUBLIC_KEY_SPKI_BASE64` /
  `BOTBLOCKER_ED25519_PREVIOUS_VERIFY_UNTIL_MS`: optional rotation-overlap group, required
  all together when used. The previous key contains public SPKI DER only (canonical
  base64), and the deadline is a positive Unix timestamp in milliseconds. Verification
  rejects that key at the exact deadline.
- `BOTBLOCKER_ED25519_REVOKED_KEY_IDS`: optional comma-separated key IDs with no spaces.
  Revocation overrides an unexpired previous-key overlap immediately. The active key ID
  cannot appear in this list; replace the active key first during incident rotation.
- `BOTBLOCKER_CLOCK_SKEW_MS`: optional integer from `0` through `300000`; defaults to `0`,
  preserving zero implicit skew. Configure the smallest operationally justified value.
  It applies symmetrically to future issuance and expiry validation.
- `BOTBLOCKER_SITE_CREDENTIAL_HASH_SECRET`: optional until BotBlocker runtime credentials
  are deliberately provisioned; at least 32 random characters and independent from
  `API_KEY_HASH_SECRET` and every OTP/signing secret. It keys hashes of server-only
  `potp_bb_*` site credentials.
- `BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET`: optional until project-scoped BotBlocker runtime
  routing is activated; at least 32 random characters and dedicated only to immutable endpoint
  token HMACs. Do not reuse an API-key, credential, callback, visitor-token, or signing secret.
- `BOTBLOCKER_VISITOR_TOKEN_SECRET`: optional until BotBlocker visitor sessions are activated;
  at least 32 random characters and dedicated only to 30-minute project/site/session/audience
  tokens. Do not reuse `BOTBLOCKER_WEBHOOK_ENDPOINT_SECRET` or any other secret.
- `BOTBLOCKER_RUNTIME_ORIGIN`: optional exact HTTPS origin for the runtime API. The
  planned primary public origin is `https://verify.powerotp.com`; leave it unset until
  the Cloudflare Worker is deployed. The Worker will retain at least 30 days of current
  user-intelligence, denylisted-IP, and user-row-derived verify lookup data.
  `https://api.powerotp.com` remains the authoritative full-history master-data service and
  required fallback rapid-check origin when the Worker is unavailable or cannot resolve a
  lookup.
- `INTERACTION_TOKEN_SECRET`: at least 32 random bytes
- `CONFIG_ENCRYPTION_KEY`: at least 32 random bytes, independent from the token secret
- `SESSION_HASH_SECRET`: at least 32 random bytes, independent from other secrets
- `API_KEY_HASH_SECRET`: at least 32 random bytes, independent from other secrets
- `PASSWORD_PEPPER`: at least 32 random bytes, independent from every other secret. Mixed
  into every customer password hash via Argon2's own `secret` option (see
  `backend/packages/api/src/security.ts` and `docs/AS_BUILT.md`'s "Customer signup flow" section) —
  never stored alongside the hash. Rotating it invalidates every existing password hash,
  so treat it the same as any other long-lived secret once real customers exist.
- `PII_ENCRYPTION_KEY`: at least 32 random bytes, independent from every other secret
  (including `CONFIG_ENCRYPTION_KEY`, a different security domain). Encrypts a customer
  account's real email address at rest (`users.emailEncrypted`) — see `docs/AS_BUILT.md`'s
  "Customer signup flow" section for the full SOC 2-oriented design. Rotating it makes
  every existing account's stored email undecryptable, so treat it the same as any other
  long-lived secret once real customers exist.
- `EMAIL_LOOKUP_HASH_SECRET`: at least 32 random bytes, independent from every other
  secret (including `PII_ENCRYPTION_KEY` — encryption and lookup-indexing are different
  concerns). A deterministic keyed hash of an account's email, stored alongside
  `emailEncrypted` as `emailLookupHash` — the only way `users` is ever queried by email
  (login, duplicate-registration checks), since the encrypted value can't be queried
  against directly. Rotating it makes every existing account's email lookup fail
  (effectively locking out every customer until they re-register), so treat it with the
  same care as `PASSWORD_PEPPER`.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: the single platform admin's login credentials
- `ADMIN_ALLOWED_IPS`: comma-separated exact IP addresses allowed to sign in at
  `/admin/login` — no other IP can log in regardless of password. The literal entry
  `0.0.0.0` is a deliberate "allow all IPs" opt-out (see
  `backend/packages/api/src/ip-allowlist.ts`) for when you need to log in from a genuinely dynamic
  IP; using it means admin login relies on the password alone, dropping IP as a second
  factor — prefer real IPs when you can.
- `BREVO_API_KEY`: production transactional-email API key
- `POWEROTP_SIGNUP_EMAIL_TEMPLATE_ID`: optional. Numeric Brevo template id for the
  account signup-verification email — named after what it is, not the provider, so it's
  unambiguous next to any future per-customer branded OTP-delivery template id. See
  `docs/AS_BUILT.md`'s "Customer signup flow" section for the HTML to paste into a new
  Brevo template (name the template itself something obvious in the Brevo dashboard too,
  e.g. "POWEROTP - Sign Up Email Template") and where to find its id. Leave unset to keep
  the original inline-HTML verification email working exactly as before.
- `EMAIL_FROM`: verified POWEROTP sender address. Also the `sender.email` for
  every `email_code` verification delivery (see `backend/packages/api/src/email-otp-service.ts`
  and `docs/AS_BUILT.md`'s "Email verification type, customer branding, and
  dashboard redesign" section) — no separate env var needed for that type;
  it reuses this and `BREVO_API_KEY` directly. `email_code`'s own rate
  (admin-entered, a single flat USD/email value, not per-country) is set at
  `/admin`, not via an env var — see that section.
- `PUBLIC_APP_URL=https://powerotp.com`
- `PUBLIC_API_URL=https://api.powerotp.com`
  The backend uses `PUBLIC_API_URL` for API links and `PUBLIC_APP_URL` for modal/widget,
  email, and Stripe return UI links.
- `DEMO_PROJECT_SLUG`: optional; slug of the project backing the public "try it now"
  widget on the marketing site — use `demo`. After deploy, sign in at `/admin` and click
  "Provision demo project" once to create it at that exact slug. Leave the variable
  unset to keep the demo endpoints disabled.
- `TRUNK1_URL` / `TRUNK1_USER` / `TRUNK1_PASS` through `TRUNK6_*`: optional VoIP.ms trunk
  credentials, a flat numbered pool — any configured trunk can serve any of the three
  voice verification methods (`call_reachability`, `voice_code`, `voice_challenge`); the
  telephony-agent rotates across whichever trunks are currently healthy and fails over to
  the next one on a provider-level error. See `backend/packages/api/src/outbound-trunks.ts` and the
  "Outbound trunk pool" section of `docs/AS_BUILT.md` for the full design. `TRUNK1..6`
  gives headroom beyond the 3 numbers in use today; raising the cap later (e.g.
  `TRUNK7_*`) is a one-line change. Leave unset until telephony wiring, or add/remove
  numbers at any time — the agent picks up pool changes within one poll cycle, no
  redeploy needed.
- `TRUNK1_DID` through `TRUNK6_DID`: optional, a 4th value per trunk — that trunk's own
  phone number. Independent of that trunk's url/user/pass (a DID doesn't need SIP
  credentials to send SMS) and never sent to a telephony node — its only consumer is
  `sms_code` (see next bullet), which rotates across every `TRUNKn_DID` you set instead
  of needing a separate dedicated SMS number.
- `VOIPMS_SMS_API_USERNAME` / `VOIPMS_SMS_API_PASSWORD`: optional VoIP.ms REST API
  credentials for `sms_code` (your VoIP.ms account email + a distinct API key generated
  on the "SOAP and REST/JSON API" page in the VoIP.ms portal — not your portal login
  password, and not the same thing as a SIP trunk's username/password). These are
  deliberately separate from the SIP-shaped `TRUNKn_URL/USER/PASS` variables because the
  control plane sends SMS directly over HTTPS; no Asterisk node receives them. The
  actual sending number(s) come from `TRUNKn_DID` above, not a dedicated SMS-only
  variable — `backend/packages/api/src/sms.ts` rotates round-robin across every configured
  `TRUNKn_DID` and falls over to the next one if a send is rejected, so `sms_code`
  isn't limited to one number. The adapter uses POST form data so the API password is
  never placed in a request URL. Leave the two credentials and every `TRUNKn_DID`
  unset until the provider account is ready; `sms_code` then fails closed with
  `method_not_available`.
- `NODE_SECRET`: at least 32 random bytes, the single shared secret every telephony
  droplet uses to authenticate to `/v1/nodes/config` (see `backend/packages/api/src/node-service.ts`
  and `docs/AS_BUILT.md`'s "Phase 4 node identity" section). Not a per-node value and
  never edited on a droplet — it is baked into a node's deployment once, and rotating it
  is only ever an App Platform env var edit plus redeploying every node with the new
  value.
- `SPACES_ENDPOINT` / `SPACES_BUCKET` / `SPACES_ACCESS_KEY` / `SPACES_SECRET_KEY`:
  optional, a private DigitalOcean Spaces bucket holding `voice_challenge` (Type 3)
  recordings — see `docs/PROVIDER_CHECKLIST.md`. Leave all four unset to keep the admin
  recording/challenge APIs and `voice_challenge` failing closed with
  `method_not_available`/`media_storage_not_configured`.
- `MEDIA_MANIFEST_SECRET`: optional, at least 32 random bytes, independent from every
  other secret (never reused for `NODE_SECRET`) — signs the media manifest telephony
  nodes verify before trusting a recording checksum (see
  `backend/packages/api/src/challenge-service.ts#currentManifest`). Also written to each droplet's
  `/etc/powerotp/agent.env`, the exact same value, the same way `NODE_SECRET` is (see
  `infrastructure/asterisk/README.md`).
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`: optional, Stripe API credentials backing
  fixed-amount ($5/$25/$50/$100) customer balance top-ups — see
  `backend/packages/api/src/stripe-service.ts` and `docs/AS_BUILT.md`'s "Customer balance billing"
  section. `STRIPE_WEBHOOK_SECRET` is the signing secret for the specific webhook
  endpoint configured in the Stripe dashboard to point at
  `https://api.powerotp.com/v1/billing/stripe/webhook`, not the API secret key itself. Leave
  both unset to keep top-ups failing closed with `billing_not_configured`.

## Domains

`powerotp.com` points to the frontend component. `api.powerotp.com` points to the
backend component. `na1.powerotp.com` continues to point directly at the first
telephony droplet. The browser backend permits credentialed CORS only from the exact
`PUBLIC_APP_URL`; never use a wildcard origin with session cookies.

## Release checks

App Platform should use Node 22. A deployment is healthy only when:

- `https://powerotp.com/api/health` returns `200`
- `https://api.powerotp.com/health` returns `200`
- `https://api.powerotp.com/ready` returns `200` once Atlas and Valkey are reachable
- `https://api.powerotp.com/v1/capabilities` returns the verification types/states (proves the API routes are
  actually being served, not falling through to the Next.js 404 page)
- `https://powerotp.com/` returns the marketing site

The app intentionally fails startup when required configuration is missing or data
stores are unreachable.
