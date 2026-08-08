# DigitalOcean App Platform setup

Set this app up in DigitalOcean exactly the same way as every other app here: connect
the GitHub repo through the normal "Create App" flow and let App Platform auto-detect
the build/run commands. There is no App Spec YAML to paste in and nothing infrastructure-
as-code about this — the root `package.json`'s `build`/`start` scripts already do the
right thing for a plain Node.js app.

## Repository selection

- Repository: `Ericsipad/POWEROTP`
- Branch: `main`
- Source directory: `/` (not a subfolder — this is an npm workspace monorepo and the
  build needs the root lockfile plus the shared library packages)
- Auto-detected environment: Node.js

App Platform should detect `npm run build` and `npm run start` from the root
`package.json` automatically. If it asks you to confirm or override them, they should
read exactly:

- Build command: `npm run build`
- Run command: `npm start`
- HTTP port: whatever App Platform assigns via its `PORT` environment variable (the app
  reads it automatically; you don't need to hardcode one)

## One component, one normal Next.js app

Everything — the marketing/dashboard site, the customer and verification API under
`/v1`, its durable background workers, and the public `/mcp` integration guide — is one
Next.js app (`apps/web`), built and run like any other Next.js app. `apps/api` and
`apps/mcp` are library code imported by it, not separate services. There is nothing else
to create in App Platform: one app, one component.

Do not deploy `apps/telephony-agent` to App Platform. It belongs on each Asterisk droplet
in Phase 4.

## Required App Platform variables

Enter these once as environment variables in the App Platform UI (your app's Settings →
App-Level Environment Variables, same as your other apps). Do not commit their values
and do not create a repository `.env` file.

- `MONGODB_URI`: MongoDB Atlas TLS connection string
- `VALKEY_URL`: authenticated `rediss://` connection string
- `INTERACTION_TOKEN_SECRET`: at least 32 random bytes
- `CONFIG_ENCRYPTION_KEY`: at least 32 random bytes, independent from the token secret
- `SESSION_HASH_SECRET`: at least 32 random bytes, independent from other secrets
- `API_KEY_HASH_SECRET`: at least 32 random bytes, independent from other secrets
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: the single platform admin's login credentials
- `ADMIN_ALLOWED_IPS`: comma-separated exact IP addresses allowed to sign in at
  `/admin/login` — no other IP can log in regardless of password. The literal entry
  `0.0.0.0` is a deliberate "allow all IPs" opt-out (see
  `apps/api/src/ip-allowlist.ts`) for when you need to log in from a genuinely dynamic
  IP; using it means admin login relies on the password alone, dropping IP as a second
  factor — prefer real IPs when you can.
- `BREVO_API_KEY`: production transactional-email API key
- `EMAIL_FROM`: verified POWEROTP sender address
- `PUBLIC_APP_URL` / `PUBLIC_API_URL`: both `https://powerotp.com` (see Domains below)
- `DEMO_PROJECT_SLUG`: optional; slug of the project backing the public "try it now"
  widget on the marketing site — use `demo`. After deploy, sign in at `/admin` and click
  "Provision demo project" once to create it at that exact slug. Leave the variable
  unset to keep the demo endpoints disabled.
- `TRUNK1_URL` / `TRUNK1_USER` / `TRUNK1_PASS` through `TRUNK6_*`: optional VoIP.ms trunk
  credentials, a flat numbered pool — any configured trunk can serve any of the three
  voice verification methods (`call_reachability`, `voice_code`, `voice_challenge`); the
  telephony-agent rotates across whichever trunks are currently healthy and fails over to
  the next one on a provider-level error. See `apps/api/src/outbound-trunks.ts` and the
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
  variable — `apps/api/src/sms.ts` rotates round-robin across every configured
  `TRUNKn_DID` and falls over to the next one if a send is rejected, so `sms_code`
  isn't limited to one number. The adapter uses POST form data so the API password is
  never placed in a request URL. Leave the two credentials and every `TRUNKn_DID`
  unset until the provider account is ready; `sms_code` then fails closed with
  `method_not_available`.
- `NODE_SECRET`: at least 32 random bytes, the single shared secret every telephony
  droplet uses to authenticate to `/v1/nodes/config` (see `apps/api/src/node-service.ts`
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
  `apps/api/src/challenge-service.ts#currentManifest`). Also written to each droplet's
  `/etc/powerotp/agent.env`, the exact same value, the same way `NODE_SECRET` is (see
  `infrastructure/asterisk/README.md`).

## Domains

There is exactly one public web-facing domain, `powerotp.com` (plus `na1.powerotp.com`,
which points directly at the first telephony droplet, not App Platform). One process
serves every path on that single domain — `PUBLIC_APP_URL` and `PUBLIC_API_URL` are
therefore both `https://powerotp.com`. Do not create separate `app.`/`api.`/`mcp.`
subdomains or point either URL at one; the app will build broken absolute URLs (e.g.
`statusUrl`) if it does.

## Release checks

App Platform should use Node 22. A deployment is healthy only when:

- `/health` returns `200`
- `/ready` returns `200` once Atlas and Valkey are reachable
- `/v1/capabilities` returns the verification types/states (proves the API routes are
  actually being served, not falling through to the Next.js 404 page)
- `/` returns the marketing site

The app intentionally fails startup when required configuration is missing or data
stores are unreachable.
