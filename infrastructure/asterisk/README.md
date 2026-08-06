# Asterisk node boundary

See [`docs/AS_BUILT.md`](../../docs/AS_BUILT.md) ("Phase 4 node identity" and "Telephony
droplet" sections) for the ground truth of what is actually installed on
`powerotpvoip1` today. Summary:

- Native Asterisk 20 (Ubuntu 24.04 apt package) and PJSIP on the droplet.
- Localhost-only ARI (bound to `127.0.0.1`, never exposed) controlled by
  `apps/telephony-agent`, which is deployed as the hardened `systemd` unit in this
  directory (`powerotp-agent.service`).
- Node identity is a **per-node hashed bearer secret** issued at enrollment
  (`POST /v1/admin/nodes`), not mutual TLS — true mTLS termination is not
  straightforward on DigitalOcean App Platform's shared ingress, so the agent
  authenticates back to the control plane the same way a customer server authenticates
  to the verification API (`Authorization: Bearer <secret>` over TLS). See
  `libraries/contracts/src/nodes.ts` and `apps/api/src/node-service.ts`.
- No customer-facing API, public ARI/AMI, Docker, or Portainer.
- Media synchronization from private Spaces is not built yet (Phase 5).
- The node's own bearer secret and its assigned outbound trunk credentials are the only
  configuration it ever holds; every other app secret stays in App Platform.

## Deploying/updating the agent on a droplet

There is no CI/CD pipeline for the droplet yet; a session deploys it manually:

1. From a clean local `main` checkout: `git archive --format=tar.gz -o /tmp/powerotp-deploy.tar.gz HEAD`.
2. `scp` the archive to the droplet, extract it to `/opt/powerotp`, `npm ci`, then
   `npm run build -w @powerotp/contracts -w @powerotp/telephony-agent`.
3. `chown -R potp-agent:asterisk /opt/powerotp`.
4. Copy `powerotp-agent.service` (this directory) to
   `/etc/systemd/system/powerotp-agent.service`, `systemctl daemon-reload`.
5. `/etc/powerotp/agent.env` holds `CONTROL_PLANE_URL`, `ASTERISK_PJSIP_TRUNKS_PATH`,
   `POLL_INTERVAL_MS`, and `NODE_SECRET` (filled in once from `/admin`'s "Telephony
   nodes" panel — shown exactly once). `/etc/powerotp/ari.env` holds the local-only ARI
   user credential generated directly on the droplet at install time. Both files are
   `640 root:asterisk`, readable only by `potp-agent`.
6. `systemctl enable --now powerotp-agent`.

Do not add real SIP, ARI, enrollment, SSH, or Spaces credentials to the repository —
`agent.env`/`ari.env` exist only on the droplet, never here.
