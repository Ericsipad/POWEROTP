# Asterisk node boundary

See [`docs/AS_BUILT.md`](../../docs/AS_BUILT.md) ("Phase 4 node identity" and "Telephony
droplet" sections) for the ground truth of what is actually installed on
`powerotpvoip1` today. Summary:

- Native Asterisk 20 (Ubuntu 24.04 apt package) and PJSIP on the droplet.
- Localhost-only ARI (bound to `127.0.0.1`, never exposed) controlled by
  `apps/telephony-agent`, which is deployed as the hardened `systemd` unit in this
  directory (`powerotp-agent.service`).
- Node identity is **one shared secret, `NODE_SECRET`**, entered once in App Platform and
  identical across every droplet — not a per-node value generated through an admin flow,
  and not mutual TLS (true mTLS termination is not straightforward on DigitalOcean App
  Platform's shared ingress). A droplet is never individually configured or edited after
  it's deployed: `CONTROL_PLANE_URL` and `NODE_SECRET` are baked into its deployment once,
  and every other setting (which trunks exist, their credentials) is pulled automatically
  from `GET /v1/nodes/config` on every poll. See `libraries/contracts/src/nodes.ts` and
  `apps/api/src/node-service.ts`.
- No customer-facing API, public ARI/AMI, Docker, or Portainer.
- Media synchronization from private Spaces is not built yet (Phase 5).
- Adding a node is deploying the agent there with the current `NODE_SECRET`. Revoking
  access is rotating `NODE_SECRET` in App Platform and redeploying every node with the
  new value — there is no per-node enrollment or revocation.

## Deploying/updating the agent on a droplet

There is no CI/CD pipeline for the droplet yet; a session deploys it manually:

1. From a clean local `main` checkout: `git archive --format=tar.gz -o /tmp/powerotp-deploy.tar.gz HEAD`.
2. `scp` the archive to the droplet, extract it to `/opt/powerotp`, `npm ci`, then
   `npm run build -w @powerotp/contracts -w @powerotp/telephony-agent`.
3. `chown -R potp-agent:asterisk /opt/powerotp`.
4. Copy `powerotp-agent.service` (this directory) to
   `/etc/systemd/system/powerotp-agent.service`, `systemctl daemon-reload`.
5. Write `/etc/powerotp/agent.env` with `CONTROL_PLANE_URL=https://powerotp.com`,
   `ASTERISK_PJSIP_TRUNKS_PATH=/etc/asterisk/pjsip_trunks.conf`, `POLL_INTERVAL_MS=60000`,
   and `NODE_SECRET` set to the exact same value as App Platform's `NODE_SECRET` — the
   deploying session writes this once as part of standing the node up; it is never edited
   on the node again afterward, including when trunk credentials change (those flow
   automatically through `/v1/nodes/config` instead). `/etc/powerotp/ari.env` holds the
   local-only ARI user credential generated directly on the droplet at install time. Both
   files are `640 root:asterisk`, readable only by `potp-agent`.
6. Asterisk's packaged `asterisk.service` doesn't apply `asterisk.conf`'s
   `astctlpermissions`/`astctlgroup` settings reliably on this build, so
   `/var/run/asterisk/asterisk.ctl` is recreated `srwxr-xr-x` (owner-only write) on every
   restart — `potp-agent` (group `asterisk`) could connect but not issue commands like
   `pjsip reload`. Fixed with a systemd drop-in, not a one-off `chmod` (which the next
   Asterisk restart would silently undo): `/etc/systemd/system/asterisk.service.d/override.conf`
   contains `ExecStartPost=/bin/chmod 660 /var/run/asterisk/asterisk.ctl` — this is the
   exact drop-in mechanism the packaged unit's own comments recommend, and it reliably
   runs after the socket exists because the unit is `Type=notify` (systemd waits for
   Asterisk's ready notification, which comes after socket creation, before running
   `ExecStartPost`).
7. `systemctl enable --now powerotp-agent`.

Do not add real SIP, ARI, or SSH credentials to the repository — `agent.env`/`ari.env`
exist only on the droplet, never here. `NODE_SECRET` itself is entered in App Platform,
same as every other production secret.
