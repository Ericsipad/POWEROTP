# Phase 2 account and project operations

## Required services

- MongoDB Atlas production connection
- DigitalOcean Managed Valkey TLS connection
- Brevo transactional-email API key and verified sender
- App Platform web and API components routed through the same public origin

Enter all values through App Platform encrypted variables. Generate each cryptographic
secret independently with at least 32 random bytes.

## First platform administrator

The bootstrap endpoint works only while no platform administrator exists. Set a temporary
high-entropy `ADMIN_BOOTSTRAP_TOKEN`, then make one server-side request:

```sh
curl -X POST "https://api.powerotp.com/v1/admin/bootstrap" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Bootstrap-Token: $ADMIN_BOOTSTRAP_TOKEN" \
  --data '{"email":"ADMIN_EMAIL","password":"ADMIN_STRONG_PASSWORD"}'
```

The response contains one `otpauth://` URI. Add it to the administrator’s authenticator,
confirm login through `/admin/login`, then remove `ADMIN_BOOTSTRAP_TOKEN` from App Platform.
The endpoint remains disabled after the first administrator record exists.

Never place the bootstrap token, password, TOTP URI, API keys, or callback secrets in the
repository, deployment logs, support tickets, or AI prompts.

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
