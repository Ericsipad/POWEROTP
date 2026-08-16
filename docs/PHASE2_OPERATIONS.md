# Phase 2 account and project operations

## Required services

- MongoDB Atlas production connection
- DigitalOcean Managed Valkey TLS connection
- Brevo transactional-email API key and verified sender
- The frontend App Platform component serving `powerotp.com`
- The backend App Platform component serving `api.powerotp.com` (`/v1/*`, `/mcp`,
  `/health`, `/ready`, and durable workers)

Frontend browser calls use `NEXT_PUBLIC_API_URL=https://api.powerotp.com`. On the
backend, `PUBLIC_API_URL=https://api.powerotp.com` emits API links and
`PUBLIC_APP_URL=https://powerotp.com` emits modal/widget, email, and Stripe return UI
links.

Enter secrets on the backend component only. Generate each cryptographic secret
independently with at least 32 random bytes.

### Provisioning Valkey

Valkey is created as its own DigitalOcean **Managed Database** resource (Databases →
Create Database Cluster → engine Valkey), separate from the App Platform app and from
any telephony droplet. Once created, copy its `rediss://` connection string into the
app-level `VALKEY_URL` environment variable in App Platform. Phase 2 uses it for
rate limiting; Phase 3 also uses it (via BullMQ) for the verification dispatch, timeout,
and signed-callback-retry queues. No droplet ever needs direct access to Valkey.

## Platform administrator

There is exactly one platform admin, and its identity lives entirely in App Platform
environment variables — not a database account created through any endpoint:

- `ADMIN_EMAIL`: the admin's login email
- `ADMIN_PASSWORD`: the admin's login password (plain value in the encrypted env var, not
  hashed — there's nothing to hash against since it's compared directly at login time)
- `ADMIN_ALLOWED_IPS`: comma-separated exact IP addresses permitted to sign in at
  `/admin/login`; no CIDR ranges, no login is possible from any other IP regardless of
  whether the password is correct

Set all three, then sign in at `/admin/login`. Changing the admin password or the
allowlist is just editing these variables and redeploying — there is no reset flow,
recovery email, or database record to update.

Never place these values in the repository, deployment logs, support tickets, or AI
prompts.

## Customer registration

1. Customer submits `/register`.
2. API creates an unverified customer and sends a one-hour Brevo verification link.
3. `/verify-email` consumes the one-time token.
4. `/login` issues a secure, strict same-site, HTTP-only session cookie and a CSRF token.
5. Customer creates projects through `/dashboard`.

Registration returns the same accepted result for existing verified addresses to reduce
account enumeration.

## Project credentials

- API keys and callback signing secrets are shown once.
- Only keyed hashes of API keys are stored.
- Callback secrets are encrypted with authenticated encryption.
- Rotation revokes the prior API key immediately in Phase 2.
- Store revealed values in the customer’s server secret manager, never frontend code.

## Recovery and support

Password reset, account recovery, additional administrators, and support impersonation are
not enabled in Phase 2. Do not alter MongoDB records manually to bypass authentication.
Those workflows require dedicated audited implementations before use.
