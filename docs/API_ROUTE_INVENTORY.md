# API route and integration inventory

This is the canonical inventory of Next.js route handlers in
`backend/apps/server/app`. Unless a row says otherwise, the expected production
origin is `https://api.powerotp.com`.

BotBlocker runtime routes under `/v1/botblocker/*` have a **planned** primary
edge origin of `https://verify.powerotp.com` via Cloudflare Workers. Workers are
not currently claimed as deployed. `https://api.powerotp.com` remains the
authoritative full-history master and fallback rapid-check backend.

Usage classes describe the route's callers, not its implementation status:
`browser`, `server-to-server`, `webhook`, `node`, `admin`, or `public`.

| Route file | HTTP path | Methods | Auth | Usage class | Consumers | Expected production origin |
| --- | --- | --- | --- | --- | --- | --- |
| `app/health/route.ts` | `/health` | `GET` | None | public | App Platform and uptime probes | `https://api.powerotp.com` |
| `app/mcp/route.ts` | `/mcp` | `GET, POST, DELETE` | None; anonymous read-only MCP | public | MCP-compatible AI clients | `https://api.powerotp.com` |
| `app/ready/route.ts` | `/ready` | `GET` | None | public | App Platform and operators | `https://api.powerotp.com` |
| `app/v1/admin/billing/accounting/route.ts` | `/v1/admin/billing/accounting` | `GET` | Admin session | admin | Admin accounting configuration panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/ad-payouts/route.ts` | `/v1/admin/billing/ad-payouts` | `PUT` | Admin session + CSRF | admin | Admin 10-day ad payout calendar | `https://api.powerotp.com` |
| `app/v1/admin/billing/ad-systems/route.ts` | `/v1/admin/billing/ad-systems` | `PUT` | Admin session + CSRF | admin | Admin accounting configuration panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/call-rates/route.ts` | `/v1/admin/billing/call-rates` | `GET, PUT` | Admin session; CSRF on PUT | admin | Admin billing rates panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/credit/route.ts` | `/v1/admin/billing/credit` | `POST` | Admin session + CSRF | admin | Admin billing ledger panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/email-rate/route.ts` | `/v1/admin/billing/email-rate` | `GET, PUT` | Admin session; CSRF on PUT | admin | Admin billing rates panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/ledger/route.ts` | `/v1/admin/billing/ledger` | `GET` | Admin session | admin | Admin billing ledger panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/plan-charges/route.ts` | `/v1/admin/billing/plan-charges` | `GET, PUT` | Admin session; CSRF on PUT | admin | Admin billing rates panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/referral-commissions/route.ts` | `/v1/admin/billing/referral-commissions` | `PUT` | Admin session + CSRF | admin | Admin accounting configuration panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/sms-rates/route.ts` | `/v1/admin/billing/sms-rates` | `GET, PUT` | Admin session; CSRF on PUT | admin | Admin billing rates panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/thresholds/[ruleId]/route.ts` | `/v1/admin/billing/thresholds/{ruleId}` | `PATCH` | Admin session + CSRF | admin | Admin accounting configuration panel | `https://api.powerotp.com` |
| `app/v1/admin/billing/thresholds/route.ts` | `/v1/admin/billing/thresholds` | `POST` | Admin session + CSRF | admin | Admin accounting configuration panel | `https://api.powerotp.com` |
| `app/v1/admin/callback-deliveries/route.ts` | `/v1/admin/callback-deliveries` | `GET` | Admin session | admin | Admin callback deliveries panel | `https://api.powerotp.com` |
| `app/v1/admin/challenges/[id]/route.ts` | `/v1/admin/challenges/{id}` | `DELETE` | Admin session + CSRF | admin | Admin challenge manager | `https://api.powerotp.com` |
| `app/v1/admin/challenges/route.ts` | `/v1/admin/challenges` | `GET, POST` | Admin session; CSRF on POST | admin | Admin challenge manager | `https://api.powerotp.com` |
| `app/v1/admin/demo-project/route.ts` | `/v1/admin/demo-project` | `POST` | Admin session + CSRF | admin | Admin demo-project action | `https://api.powerotp.com` |
| `app/v1/admin/login/route.ts` | `/v1/admin/login` | `POST` | Allowed web origin, admin IP allowlist, credentials, and rate limit | admin/browser | Admin login page | `https://api.powerotp.com` |
| `app/v1/admin/nodes/route.ts` | `/v1/admin/nodes` | `GET` | Admin session | admin | Admin node status page | `https://api.powerotp.com` |
| `app/v1/admin/queues/route.ts` | `/v1/admin/queues` | `GET` | Admin session | admin | Admin operations panel | `https://api.powerotp.com` |
| `app/v1/admin/recordings/[id]/route.ts` | `/v1/admin/recordings/{id}` | `DELETE` | Admin session + CSRF | admin | Admin recording manager | `https://api.powerotp.com` |
| `app/v1/admin/recordings/route.ts` | `/v1/admin/recordings` | `GET, POST` | Admin session; CSRF on POST | admin | Admin recording manager | `https://api.powerotp.com` |
| `app/v1/admin/usage/route.ts` | `/v1/admin/usage` | `GET` | Admin session | admin | Admin usage panel | `https://api.powerotp.com` |
| `app/v1/admin/widget-interactions/route.ts` | `/v1/admin/widget-interactions` | `GET` | Admin session | admin | Admin widget interactions panel | `https://api.powerotp.com` |
| `app/v1/auth/login/route.ts` | `/v1/auth/login` | `POST` | Allowed web origin; credentials; rate limit | browser/public | Customer login page | `https://api.powerotp.com` |
| `app/v1/auth/logout/route.ts` | `/v1/auth/logout` | `POST` | Customer/admin session + CSRF | browser | Dashboard and admin UI | `https://api.powerotp.com` |
| `app/v1/auth/register/route.ts` | `/v1/auth/register` | `POST` | Allowed web origin; rate limit | browser/public | Legacy registration page | `https://api.powerotp.com` |
| `app/v1/auth/session/route.ts` | `/v1/auth/session` | `GET` | Session cookie + CSRF cookie | browser | Dashboard and admin UI | `https://api.powerotp.com` |
| `app/v1/auth/signup/route.ts` | `/v1/auth/signup` | `POST` | Allowed web origin; rate limit | browser/public | Rapid signup modal | `https://api.powerotp.com` |
| `app/v1/auth/verify-email/route.ts` | `/v1/auth/verify-email` | `POST` | Email token; allowed web origin; rate limit | browser/public | Email verification page | `https://api.powerotp.com` |
| `app/v1/billing/balance/route.ts` | `/v1/billing/balance` | `GET` | Customer session | browser | Dashboard billing panel | `https://api.powerotp.com` |
| `app/v1/billing/ledger/route.ts` | `/v1/billing/ledger` | `GET` | Customer session | browser | Dashboard billing panel | `https://api.powerotp.com` |
| `app/v1/billing/stripe/webhook/route.ts` | `/v1/billing/stripe/webhook` | `POST` | Stripe webhook signature | webhook | Stripe | `https://api.powerotp.com` |
| `app/v1/billing/topups/route.ts` | `/v1/billing/topups` | `POST` | Customer session + CSRF | browser | Dashboard billing panel | `https://api.powerotp.com` |
| `app/v1/botblocker/agent/entitlements/[webhookId]/route.ts` | `/v1/botblocker/agent/entitlements/{webhookId}` | `POST` | Self-validating project/site endpoint + scoped visitor token + envelope | server-to-server | BotBlocker agents/adapters | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/botblocker/challenges/[webhookId]/[challengeId]/complete/route.ts` | `/v1/botblocker/challenges/{webhookId}/{challengeId}/complete` | `POST` | Self-validating project/site endpoint + scoped visitor token + envelope | server-to-server | BotBlocker challenge clients | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/botblocker/challenges/[webhookId]/[challengeId]/route.ts` | `/v1/botblocker/challenges/{webhookId}/{challengeId}` | `GET` | Self-validating project/site endpoint + scoped visitor token + bound read headers | server-to-server | BotBlocker challenge clients | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/botblocker/challenges/[webhookId]/route.ts` | `/v1/botblocker/challenges/{webhookId}` | `POST` | Self-validating project/site endpoint + scoped visitor token + envelope | server-to-server | BotBlocker challenge clients | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/botblocker/paid-passes/assert/[webhookId]/route.ts` | `/v1/botblocker/paid-passes/assert/{webhookId}` | `POST` | Self-validating project/site endpoint + scoped visitor token + envelope | server-to-server | BotBlocker paid-pass adapters | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/botblocker/passports/assert/[webhookId]/route.ts` | `/v1/botblocker/passports/assert/{webhookId}` | `POST` | Self-validating project/site endpoint + scoped visitor token + envelope | server-to-server | BotBlocker passport adapters | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/botblocker/passports/register/[webhookId]/route.ts` | `/v1/botblocker/passports/register/{webhookId}` | `POST` | Self-validating project/site endpoint + scoped visitor token + envelope | server-to-server | BotBlocker passport adapters | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/botblocker/policy/[siteId]/route.ts` | `/v1/botblocker/policy/{siteId}` | `GET` | None; public site ID selects signed policy | public/server-to-server | BotBlocker adapters and caches | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/botblocker/reports/[webhookId]/route.ts` | `/v1/botblocker/reports/{webhookId}` | `POST` | Self-validating project/site endpoint + initial site credential or later scoped visitor token + closed canonical report envelope | server-to-server | BotBlocker adapters through the shared gate-node authority | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/botblocker/session-data/[webhookId]/route.ts` | `/v1/botblocker/session-data/{webhookId}` | `GET` | Self-validating project/site endpoint + scoped visitor token + bound read headers | server-to-server | BotBlocker adapters after verified project callbacks | Planned `https://verify.powerotp.com`; master/fallback `https://api.powerotp.com` |
| `app/v1/capabilities/route.ts` | `/v1/capabilities` | `GET` | None | public | SDKs, integrations, and diagnostics | `https://api.powerotp.com` |
| `app/v1/control/botblocker/asn-classifications/route.ts` | `/v1/control/botblocker/asn-classifications` | `GET, POST` | Admin session; CSRF + Idempotency-Key on POST | admin | BotBlocker operators; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/control/botblocker/asn-type-scores/route.ts` | `/v1/control/botblocker/asn-type-scores` | `GET, POST` | Admin session; CSRF + Idempotency-Key on POST | admin | BotBlocker operators; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/control/botblocker/decision-traces/[gateSessionId]/route.ts` | `/v1/control/botblocker/decision-traces/{gateSessionId}` | `GET` | Admin session | admin | BotBlocker operators; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/control/botblocker/health/route.ts` | `/v1/control/botblocker/health` | `GET` | Admin session | admin | BotBlocker operators; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/control/botblocker/ip-blacklist/revoke/route.ts` | `/v1/control/botblocker/ip-blacklist/revoke` | `POST` | Admin session; CSRF; Idempotency-Key | admin | BotBlocker operators; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/control/botblocker/ip-blacklist/route.ts` | `/v1/control/botblocker/ip-blacklist` | `GET, POST` | Admin session; CSRF + Idempotency-Key on POST | admin | BotBlocker operators; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/control/botblocker/policy-releases/route.ts` | `/v1/control/botblocker/policy-releases` | `GET, POST` | Admin session; CSRF on POST | admin | BotBlocker operators; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/control/botblocker/profile-scoring/route.ts` | `/v1/control/botblocker/profile-scoring` | `GET, POST` | Admin session; CSRF + Idempotency-Key on POST | admin | BotBlocker operators; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/control/botblocker/risk-event-scoring/route.ts` | `/v1/control/botblocker/risk-event-scoring` | `GET, POST` | Admin session; CSRF + Idempotency-Key on POST | admin | BotBlocker operators; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/demo/verifications/[interactionId]/response/route.ts` | `/v1/demo/verifications/{interactionId}/response` | `POST` | Public demo project scope + rate limit | browser/public | Try-it-now UI | `https://api.powerotp.com` |
| `app/v1/demo/verifications/[interactionId]/route.ts` | `/v1/demo/verifications/{interactionId}` | `GET` | Public demo project scope + rate limit | browser/public | Try-it-now UI | `https://api.powerotp.com` |
| `app/v1/demo/verifications/route.ts` | `/v1/demo/verifications` | `POST` | Public demo project scope + rate limit | browser/public | Try-it-now UI | `https://api.powerotp.com` |
| `app/v1/modal-sessions/[sessionId]/ai-index-summary/route.ts` | `/v1/modal-sessions/{sessionId}/ai-index-summary` | `GET` | Unpredictable session ID + allowed origin | browser/public | Hosted widget hidden honeypot link | `https://api.powerotp.com` |
| `app/v1/modal-sessions/[sessionId]/route.ts` | `/v1/modal-sessions/{sessionId}` | `GET` | Unpredictable session ID + allowed origin | browser/public | Hosted widget | `https://api.powerotp.com` |
| `app/v1/modal-sessions/[sessionId]/verifications/route.ts` | `/v1/modal-sessions/{sessionId}/verifications` | `POST` | Unpredictable session ID + allowed origin | browser/public | Hosted widget | `https://api.powerotp.com` |
| `app/v1/nodes/config/route.ts` | `/v1/nodes/config` | `GET` | NODE_SECRET bearer token | node | Telephony agent | `https://api.powerotp.com` |
| `app/v1/nodes/jobs/[interactionId]/events/route.ts` | `/v1/nodes/jobs/{interactionId}/events` | `POST` | NODE_SECRET bearer token | node | Telephony agent | `https://api.powerotp.com` |
| `app/v1/nodes/jobs/next/route.ts` | `/v1/nodes/jobs/next` | `GET` | NODE_SECRET bearer token | node | Telephony agent | `https://api.powerotp.com` |
| `app/v1/nodes/media-manifest/route.ts` | `/v1/nodes/media-manifest` | `GET` | NODE_SECRET bearer token | node | Telephony agent media sync | `https://api.powerotp.com` |
| `app/v1/nodes/trunk-status/route.ts` | `/v1/nodes/trunk-status` | `POST` | NODE_SECRET bearer token | node | Telephony agent | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/accounting/route.ts` | `/v1/projects/{projectId}/accounting` | `GET` | Customer session + project ownership | browser | Dashboard project accounting panel | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/auth-sessions/route.ts` | `/v1/projects/{projectId}/auth-sessions` | `POST` | Project API key + Idempotency-Key + rate limit | server-to-server | Customer sign-in-as-a-service backends | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/botblocker/rotate-site-credential/route.ts` | `/v1/projects/{projectId}/botblocker/rotate-site-credential` | `POST` | Customer session + CSRF + Idempotency-Key | browser | MCP setup instructions; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/botblocker/visitors/route.ts` | `/v1/projects/{projectId}/botblocker/visitors` | `GET` | Customer session | browser | Documentation; no frontend consumer yet | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/botblocker/route.ts` | `/v1/projects/{projectId}/botblocker` | `GET, PATCH` | Customer session; CSRF on PATCH | browser | Dashboard BotBlocker panel | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/callback/route.ts` | `/v1/projects/{projectId}/callback` | `POST` | Customer session + CSRF | browser | Dashboard project settings | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/interactions/route.ts` | `/v1/projects/{projectId}/interactions` | `GET` | Customer session | browser | Dashboard verification history | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/modal-sessions/route.ts` | `/v1/projects/{projectId}/modal-sessions` | `POST` | Project API key | server-to-server | SDK, MCP examples, widget loader, customer backends | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/referral/route.ts` | `/v1/projects/{projectId}/referral` | `PUT` | Customer session + CSRF + project ownership | browser | Dashboard project accounting panel | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/rotate-api-key/route.ts` | `/v1/projects/{projectId}/rotate-api-key` | `POST` | Customer session + CSRF | browser | Dashboard project settings | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/route.ts` | `/v1/projects/{projectId}` | `PATCH` | Customer session + CSRF | browser | Dashboard project settings | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/verifications/route.ts` | `/v1/projects/{projectId}/verifications` | `POST` | Project API key + Idempotency-Key | server-to-server | SDK, MCP examples, and customer backends | `https://api.powerotp.com` |
| `app/v1/projects/[projectId]/visitors/route.ts` | `/v1/projects/{projectId}/visitors` | `GET` | Customer session | browser | Dashboard visitors panel | `https://api.powerotp.com` |
| `app/v1/projects/route.ts` | `/v1/projects` | `GET, POST` | Customer session; CSRF on POST | browser | Dashboard | `https://api.powerotp.com` |
| `app/v1/referrals/[code]/route.ts` | `/v1/referrals/{code}` | `GET` | Public syntax/active-code lookup + rate limit | public | Referral landing route | `https://api.powerotp.com` |
| `app/v1/referrals/route.ts` | `/v1/referrals` | `GET, POST` | Customer session; CSRF on POST | browser | Dashboard referral panel | `https://api.powerotp.com` |
| `app/v1/verifications/[interactionId]/response/route.ts` | `/v1/verifications/{interactionId}/response` | `POST` | Interaction token or project API key | browser/server-to-server | Hosted widget, SDK, and customer backends | `https://api.powerotp.com` |
| `app/v1/verifications/[interactionId]/route.ts` | `/v1/verifications/{interactionId}` | `GET` | Status interaction token or project API key | browser/server-to-server | Hosted widget, SDK, and customer backends | `https://api.powerotp.com` |
