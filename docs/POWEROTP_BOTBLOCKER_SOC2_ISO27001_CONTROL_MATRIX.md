# BotBlocker SOC 2 / ISO/IEC 27001:2022 control-status matrix

**POWEROTP is not SOC 2 compliant, is not ISO/IEC 27001 certified, and has not been audited.**
This matrix records, control by control, what BotBlocker's design and code *currently* do
against the criteria a future audit would examine — nothing here is a compliance claim, and no
row may be cited as evidence of certification. See
[`PASSPORT_BUSINESS_AND_LEGAL_PLAN.md`](PASSPORT_BUSINESS_AND_LEGAL_PLAN.md#5-compliance-obligations-and-artifacts)
for the roadmap and cost of an eventual real audit, and
[`AS_BUILT.md`](AS_BUILT.md) for the existing OTP-platform "SOC 2-oriented data protection"
design this matrix builds on.

## How to read this matrix

- **Implemented** — the control exists in shipped code today, with an as-built entry in
  [`POWEROTP_BOTBLOCKER_AS_BUILT.md`](POWEROTP_BOTBLOCKER_AS_BUILT.md) or the main
  [`AS_BUILT.md`](AS_BUILT.md) as evidence.
- **Partially implemented** — some real mechanism exists (often on the OTP platform BotBlocker
  will reuse) but it does not yet cover BotBlocker's own data/flows, or covers only part of the
  control's intent.
- **Planned** — designed in `POWEROTP_BOTBLOCKER_PLAN.md`/`THREAT_MODEL.md` but not yet built.
  A specific future phase in
  [`POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md`](POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md) is
  named wherever possible.
- **Not applicable** — the control's subject matter does not apply to BotBlocker as designed,
  with a one-line reason.

Update this matrix's status column in the same phase that changes it — never mark a control
"Implemented" ahead of the corresponding as-built entry.

## SOC 2 (Trust Services Criteria) control status

| # | Control area | Status | Evidence / target phase |
| --- | --- | --- | --- |
| CC1 | Control environment, governance, code of conduct | Partially implemented | Existing company-level governance covers the OTP platform; no BotBlocker-specific addition needed yet |
| CC2 | Communication and information (security policies published) | Planned | This matrix and the threat model are the first artifacts; a published customer-facing security page is a Phase 31 launch item |
| CC3 | Risk assessment | Partially implemented | `THREAT_MODEL.md#botblocker-threat-model` is the current risk assessment; no formal recurring risk-assessment process exists yet |
| CC4 | Monitoring activities | Planned | Requires Phase 8 (API surface) and Phase 15 (real ingestion) before there is anything to monitor |
| CC5 | Control activities (segregation of duties) | Partially implemented | Admin/customer separation already exists on the OTP platform; BotBlocker admin routes (Phase 8) will reuse it, not duplicate it |
| CC6.1 | Logical access — least privilege | Planned | Project-scoped API keys exist for OTP; BotBlocker site credentials follow the same pattern from Phase 5 onward |
| CC6.1 | Logical access — encryption at rest for sensitive data | Partially implemented | `PII_ENCRYPTION_KEY`-based envelope encryption exists for OTP account email (`docs/AS_BUILT.md`); BotBlocker persistence (Phase 6) must use an equivalent, separately keyed pattern for any PII it stores |
| CC6.1 | Logical access — encryption in transit | Implemented | The whole platform is served over HTTPS today; no BotBlocker-specific work needed |
| CC6.2 | Access provisioning/de-provisioning | Not applicable yet | No BotBlocker user/role model exists; applies once Phase 5's dashboard panel ships |
| CC6.3 | Role-based access restrictions | Planned | Phase 5 (project configuration) and Phase 8 (admin routes) |
| CC6.6 | Boundary protection against external threats | Partially implemented | Trusted-proxy/IP rules are documented (`THREAT_MODEL.md`) but not implemented; existing App Platform network posture applies today |
| CC6.7 | Data transmission/removal controls | Planned | Retention/TTL design exists in `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` and `POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md` Phase 6; not yet built |
| CC6.8 | Malicious software prevention | Not applicable | BotBlocker does not execute customer-supplied code; adapters explicitly "never download or execute arbitrary backend code" (`POWEROTP_BOTBLOCKER_PLAN.md`) |
| CC7.1 | Vulnerability detection | Not applicable yet | No BotBlocker attack surface is deployed; applies from Phase 8 onward |
| CC7.2 | Security incident monitoring/response | Planned | No BotBlocker-specific incident runbook exists; scheduled for Phase 31 (production hardening) |
| CC7.3 | Incident evaluation and containment | Planned | Phase 31 |
| CC7.4 | Incident response execution | Planned | Phase 31 |
| CC8.1 | Change management | Implemented | Existing repository/PR/phase-gated workflow (this development-phases document itself) applies to BotBlocker from day one |
| CC9.1 | Risk mitigation — vendor/subprocessor management | Partially implemented | Didit vendor terms are reviewed for Passport (`PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` §6); no other BotBlocker subprocessor exists yet |
| CC9.2 | Business continuity / disaster recovery | Planned | Phase 31 |
| A1.1 | Availability — capacity/performance monitoring | Not applicable yet | No BotBlocker service is deployed |
| A1.2 | Availability — backup and recovery | Planned | Phase 31, alongside the existing OTP-platform backup posture |
| PI1 | Processing integrity — accurate, complete, authorized processing | Planned | Decision-sequencing/monotonic-revision rules are designed (`THREAT_MODEL.md#continuous-decision-revisions`) but not implemented; Phase 20 |
| C1.1 | Confidentiality — data classified and protected | Partially implemented | Sanitized-telemetry rules are fully specified (`THREAT_MODEL.md#sanitized-telemetry-and-prohibited-data`); enforcement in code is Phase 10 |
| P1–P8 | Privacy criteria (if in scope) | Planned | Full DPIA/LIA/consent-copy work is tracked in `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` §§3, 5, 9 |

## ISO/IEC 27001:2022 Annex A control status (representative subset)

| Annex A ref | Control | Status | Evidence / target phase |
| --- | --- | --- | --- |
| A.5.1 | Policies for information security | Planned | No published BotBlocker-specific security policy yet; company-level policy exists for the OTP platform |
| A.5.9 | Inventory of information and assets | Partially implemented | `POWEROTP_BOTBLOCKER_PLAN.md#risk-engine-and-reputation-store` enumerates planned collections; no real inventory exists until Phase 6 |
| A.5.15 | Access control | Planned | Phase 5/8, reusing the OTP platform's existing session/CSRF/API-key patterns |
| A.5.23 | Information security for cloud services | Implemented | DigitalOcean App Platform + MongoDB Atlas + Valkey are already the OTP platform's production posture; BotBlocker reuses the same infrastructure, not new cloud services |
| A.5.31 | Legal, statutory, regulatory, contractual requirements | Partially implemented | `PASSPORT_BUSINESS_AND_LEGAL_PLAN.md` §5/§10 catalogs applicable regimes and open counsel questions; not all are resolved |
| A.5.34 | Privacy and protection of PII | Partially implemented | Sanitization and retention design exists; real enforcement is Phase 6/10/15 |
| A.8.2 | Privileged access rights | Planned | Admin BotBlocker routes (Phase 8) will require the same IP-allowlisted, short-session admin pattern documented in `THREAT_MODEL.md`'s OTP section |
| A.8.5 | Secure authentication | Partially implemented | Phase 3 implements strict signed-clearance contracts and canonical Ed25519 sign/verify helpers with audience, site, session, nonce, issuance, and expiry binding; no gate consumes them until later phases |
| A.8.9 | Configuration management | Partially implemented | Phase 4 adds validated, independently named active/previous/revoked Ed25519 key and bounded-skew configuration; no BotBlocker service consumes it until later phases |
| A.8.16 | Monitoring activities | Planned | Phase 8 onward |
| A.8.20 | Networks security | Implemented | Existing App Platform network posture (no public ARI/AMI/DB ports, etc. — see `THREAT_MODEL.md`'s "Node compromise" section) already applies; nothing BotBlocker-specific changes it |
| A.8.23 | Web filtering | Not applicable | BotBlocker does not filter outbound web traffic for its own users |
| A.8.24 | Use of cryptography | Partially implemented | Phase 3 implements the separate Ed25519 trust domain; Phase 4 adds active/previous overlap, exact retirement, immediate revocation, bounded skew, validated DER key configuration, and atomic nonce consumption, but no deployed BotBlocker route consumes them yet |
| A.8.25 | Secure development lifecycle | Implemented | The phase-gated development process itself (fresh-session scoping, mandatory tests before phase closeout, explicit unavailable responses instead of fabricated behavior) is the SDLC control, effective from Phase 0 |
| A.8.26 | Application security requirements | Partially implemented | Captured in `THREAT_MODEL.md#botblocker-threat-model`; enforcement is per-phase as each surface is built |
| A.8.28 | Secure coding | Implemented | Existing repository conventions (input validation via schemas, no secrets in browser bundles, parameterized queries) apply to BotBlocker code from the first line written |
| A.8.29 | Security testing in development and acceptance | Partially implemented | Phase 1–4 unit suites now exercise contract boundaries, signature forgery/binding, key lifecycle/skew boundaries, concurrent nonce replay, and fail-closed storage errors; deployed end-to-end acceptance and penetration testing remain Phase 31 |
| A.8.32 | Change management | Implemented | Same as SOC 2 CC8.1 above |

## What this matrix intentionally does not claim

- It does not claim any current or pending audit engagement.
- It does not claim that "planned" or "partially implemented" rows meet any control's full
  intent — only implemented rows with as-built evidence do, and only for what that evidence
  actually covers.
- It does not extend the existing OTP platform's informal security posture into a certified
  status for BotBlocker; shared infrastructure is noted where genuinely shared, never implied
  elsewhere.
