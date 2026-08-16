# Phase 0 provider and infrastructure checklist

## VoIP.ms

- Dedicated canary subaccount with password authentication
- Selected regional SIP server and failover server policy
- PJSIP-compatible registration details
- Approved codecs and DTMF mode
- Maximum concurrent calls and calls-per-second
- Verified outbound caller ID/DID for every region
- Destination and international dialing permissions
- SIP encryption setting aligned with Asterisk transport
- Response codes and billing behavior for busy, no-answer, rejected, and invalid numbers
- SMS API availability, sender requirements, callbacks, opt-out handling, and country limits
- For the `sms_code` HTTPS adapter: enable REST API access and IP allowlisting, use an
  SMS-enabled DID, and set that DID's API dialing mode to E.164 so the API's existing
  `+<country><number>` contract can be forwarded without lossy rewriting
- Provider acceptable-use approval for transactional verification calls
- Low-balance and fraud notifications

Provider credentials are not committed. The platform admin stores them encrypted and
assigns them to specific telephony nodes.

## DigitalOcean App Platform

- Production app connected to this GitHub repository via the normal "Create App" flow
  (Node.js auto-detected from `package.json`; no App Spec YAML involved), documented in
  [`infrastructure/app-platform/README.md`](../infrastructure/app-platform/README.md)
- Production branch and auto-deploy policy
- Two independently scalable components; environment variables entered directly in the
  App Platform UI
- `powerotp.com` serves the frontend; `api.powerotp.com` serves `/v1/*`, `/mcp`,
  `/health`, and `/ready`
- Health checks, logs, alerts, and rollback access
- Outbound network access to Atlas, Valkey, Spaces, callbacks, and telephony nodes

## MongoDB Atlas

- Production cluster region selected near App Platform
- Least-privilege application user
- TLS connection string entered as `MONGODB_URI`
- Network access restricted as far as App Platform networking permits
- Backups, point-in-time recovery, alerts, and restore drill owner
- Index and retention review before interaction traffic

## DigitalOcean Managed Valkey

- TLS endpoint entered as `VALKEY_URL` using `rediss://`
- Authentication enabled
- Region and private-network path confirmed
- Memory policy appropriate for disposable queue/lease data
- Alerting and documented queue reconstruction from MongoDB

## DigitalOcean Spaces

- Private bucket and region selected; set as `SPACES_ENDPOINT`/`SPACES_BUCKET` in App
  Platform
- Versioning/lifecycle policy reviewed
- One access key pair with write access to the bucket, set as `SPACES_ACCESS_KEY` /
  `SPACES_SECRET_KEY` in App Platform — this is the only credential that ever exists;
  telephony droplets never receive Spaces credentials at all. A node instead downloads
  each recording via a short-lived presigned URL the control plane generates per request
  (see `backend/packages/api/src/challenge-service.ts#currentManifest`), scoped to that one object
  for a few minutes.
- CORS disabled (no browser ever talks to Spaces directly — uploads go through the
  admin API, downloads go through a node's presigned URL)
- `MEDIA_MANIFEST_SECRET` set independently in App Platform (never reused for
  `NODE_SECRET`) — signs the manifest of recording checksums a node verifies before
  trusting anything it downloads (SHA-256, `apps/telephony-agent/src/media-sync.ts`)

## First telephony droplet

Do not send credentials until Phase 4 begins. Required handoff:

- Droplet IP, Ubuntu version, region, and VPC
- Non-root sudo SSH user with key authentication
- Approved canary destination numbers
- Shared `NODE_SECRET` supplied securely during deployment; no per-node enrollment token
- Node name, region, call capacity, and assigned VoIP.ms account

Provisioning will install native Asterisk and the agent under `systemd`; it will not
install Portainer.
