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
- Provider acceptable-use approval for transactional verification calls
- Low-balance and fraud notifications

Provider credentials are not committed. The platform admin stores them encrypted and
assigns them to specific telephony nodes.

## DigitalOcean App Platform

- Production app connected to this GitHub repository
- Production branch and auto-deploy policy
- Web, API, MCP, and worker components configured from
  [`infrastructure/app-platform/app.yaml`](../infrastructure/app-platform/app.yaml)
- Encrypted environment variables entered in App Platform
- Public domains for web, API, and MCP
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

- Private bucket and region selected
- Versioning/lifecycle policy reviewed
- Separate least-privilege publishing and node-read credentials
- CORS disabled unless a documented browser flow requires it
- Manifest signing key and checksum algorithm configured

## First telephony droplet

Do not send credentials until Phase 4 begins. Required handoff:

- Droplet IP, Ubuntu version, region, and VPC
- Non-root sudo SSH user with key authentication
- Approved canary destination numbers
- One-time node enrollment token delivered through a secure channel
- Node name, region, call capacity, and assigned VoIP.ms account

Provisioning will install native Asterisk and the agent under `systemd`; it will not
install Portainer.
