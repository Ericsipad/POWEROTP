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
- `apps/telephony-agent` now places real outbound calls for `call_reachability`,
  `voice_code`, and `voice_challenge` over local ARI (see `docs/AS_BUILT.md`'s "Phase 4
  ARI call-control" and "Phase 5" sections) — no dialplan/`extensions.conf` change is
  needed for this, since originating directly into a Stasis app bypasses
  dialplan/context entirely. The agent already reads `ARI_URL`/`ARI_USER`/`ARI_PASS`
  from `/etc/powerotp/ari.env` (step 5 below), so redeploying updated agent code (step
  1–2, then `systemctl restart powerotp-agent`) is the only change needed on an
  already-deployed droplet for call-control updates; `voice_challenge`'s media sync
  needs the two additional env vars and sound directory described in step 5a below.
- Adding a node is deploying the agent there with the current `NODE_SECRET`. Revoking
  access is rotating `NODE_SECRET` in App Platform and redeploying every node with the
  new value — there is no per-node enrollment or revocation.

## Deploying/updating the agent on a droplet

There is no CI/CD pipeline for the droplet yet; a session deploys it manually:

0. **Confirm swap is present before running `npm ci`**: `swapon --show` on the droplet
   should report a 2GB `/swapfile`. The droplet has only ~961Mi of RAM, and installing
   the full monorepo's dependency tree (Next.js, the AWS SDK, `@ffmpeg-installer/ffmpeg`,
   etc. — needed to build `@powerotp/contracts`/`@powerotp/telephony-agent` even though
   the agent only runs a fraction of that tree) can OOM-kill `npm ci` and make `sshd`
   itself briefly unresponsive without it (see the "npm ci OOM-killed" incident in
   `docs/AS_BUILT.md`). If missing: `sudo fallocate -l 2G /swapfile && sudo chmod 600
   /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none
   swap sw 0 0' | sudo tee -a /etc/fstab`.
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
5a. For `voice_challenge`: also add `MEDIA_MANIFEST_SECRET` (the exact same value as App
    Platform's `MEDIA_MANIFEST_SECRET` — an independent secret, never `NODE_SECRET`) and
    `MEDIA_ROOT=/var/lib/asterisk/sounds/custom` to `/etc/powerotp/agent.env`. Create that
    directory (`mkdir -p /var/lib/asterisk/sounds/custom && chown potp-agent:asterisk
    /var/lib/asterisk/sounds/custom`) so the agent's `media-sync.ts` loop can write synced
    recordings there. `MEDIA_SOUND_PREFIX` defaults to `custom/potp` and does not need to
    be set unless recordings are placed under a different Asterisk sound-search-relative
    path. Skip this step entirely on a node that never handles `voice_challenge` — the
    media-sync loop simply never runs without `MEDIA_ROOT`/`MEDIA_MANIFEST_SECRET` set.
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
7. Append `pjsip-transport.conf` (this directory) to `/etc/asterisk/pjsip.conf` — every
   transport in the packaged sample config ships commented out, and without at least one
   active transport, outbound registrations silently fail to be created at all. See that
   file's comment for the exact symptom this causes if skipped.
8. `systemctl enable --now powerotp-agent`.

Do not add real SIP, ARI, or SSH credentials to the repository — `agent.env`/`ari.env`
exist only on the droplet, never here. `NODE_SECRET` itself is entered in App Platform,
same as every other production secret.
