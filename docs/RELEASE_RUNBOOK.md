# Production release runbook

## Before deployment

1. Confirm CI passes `npm run verify` on Node 22.
2. Review dependency audit and changed configuration requirements.
3. Confirm App Platform encrypted variables are present.
4. Confirm Atlas, Valkey, and Spaces status.
5. Keep the canary project limited to approved numbers and low spend/concurrency.

## Deploy

1. Deploy the immutable commit from `main`.
2. Wait for App Platform component health checks.
3. Confirm web `/api/health`, API `/health` and `/ready`, and MCP `/health`.
4. Confirm worker reports dependency-ready without logging connection strings.
5. Exercise the public MCP capability and request-shape tools.
6. When verification transport exists, run one canary interaction per enabled method.

## Stop conditions

Rollback immediately for:

- Failed health/readiness checks
- Cross-customer authorization failure
- Secret, code, answer, or full phone number in logs
- Duplicate calls or callbacks outside documented retry behavior
- Incorrect terminal results or out-of-order transition acceptance
- Unbounded queue growth, spend, or destination rate

## Rollback

Use App Platform deployment history to redeploy the last known-good commit. Configuration
changes must be reverted separately if they caused the incident. Do not delete event data
or clear Valkey until evidence is captured and queue reconstruction impact is understood.

## Evidence

Record commit SHA, deployment ID, start/end times, health results, canary interaction IDs,
alerts, configuration changes without values, and rollback decision in the release log.
