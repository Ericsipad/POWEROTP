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

**As of this session, this is automated.** `.github/workflows/verify.yml`'s
`deploy-droplet` job runs after every push to `main` that passes `verify`
(mirroring how DigitalOcean App Platform auto-deploys `apps/web` on every
push) — it builds the same `git archive` tarball and pipes it on **stdin** to
`potp-deploy` (this directory), the forced command its SSH key is pinned to,
which runs the same `npm ci` / build / restart sequence described below.

It authenticates as the unprivileged `potp-deploy` user, **not root**, using
four repository secrets: `DROPLET_HOST`, `DROPLET_SSH_USER` (`potp-deploy`),
`DROPLET_SSH_KEY` (a key dedicated to CI, distinct from the local-only
`ssh powerotp` alias's key), and `DROPLET_SSH_HOST_KEY` (the pinned
`known_hosts` line). None of these are committed to the repo. Because the key
is pinned to one forced command, it cannot open a shell or read
`/etc/powerotp/*.env` even if the secret leaks — so do not reintroduce a
separate `scp` step or an inline remote command list, both of which require an
unrestricted key. See `docs/AS_BUILT.md`'s "Droplet deploy hardening" section.

## Rebuilding a node from scratch (disaster recovery / new IP)

`bootstrap-node.sh` in this directory provisions a stock Ubuntu 24.04 droplet
into exactly the shape `powerotpvoip1` is in today, and is the whole answer to
"the node is gone / has to move". It is idempotent, so it is also the way to
repair a node that has drifted. Run it as root **on the new droplet**, with the
repo checked out or this directory copied over:

```bash
NODE_SECRET=... OPS_PUBKEY="ssh-ed25519 ..." CI_DEPLOY_PUBKEY="ssh-ed25519 ..." \
  MEDIA_MANIFEST_SECRET=... \
  sudo -E ./bootstrap-node.sh
```

It installs Asterisk 20 and Node 22, creates the three accounts
(`opsadmin`/`potp-agent`/`potp-deploy`), installs every file in this directory
to its real path, writes `/etc/powerotp/*.env`, applies the firewall and SSH
hardening, and prints the remaining IP-dependent steps. It deliberately does
**not** deploy application code — push to `main` (or re-run the
`deploy-droplet` job) and the CI path above populates `/opt/powerotp`.

Everything needed to rebuild is therefore committed here **except the secrets**,
which is intentional. On a rebuild you re-supply:

| Secret | Where it comes from |
| --- | --- |
| `NODE_SECRET` | App Platform — the identical value, shared by every node |
| `MEDIA_MANIFEST_SECRET` | App Platform — independent of `NODE_SECRET`; only needed for `voice_challenge` |
| `OPS_PUBKEY` | the local-only `~/.ssh/poweroTP_do_droplet.pub` |
| `CI_DEPLOY_PUBKEY` | the CI keypair; if lost, mint a new one and update `DROPLET_SSH_KEY` |
| ARI password | not re-supplied — generated fresh on the node, never leaves it |

Trunk credentials are **not** in this list: they arrive automatically from
`GET /v1/nodes/config` on the first poll, so a rebuilt node picks them up with
no manual step. Do not add real SIP, ARI, or SSH credentials to the repository.

### Why some of these steps exist (non-obvious failure modes)

Worth reading before "simplifying" anything in `bootstrap-node.sh`:

- **Swap is mandatory, not optional.** The droplet has ~961Mi of RAM and
  installing the monorepo's dependency tree can OOM-kill `npm ci` — and take
  `sshd` down with it. See the "`npm ci` OOM-killed" incident in
  `docs/AS_BUILT.md`.
- **At least one active PJSIP transport must exist.** Every transport in the
  packaged sample config ships commented out, and with none active,
  `res_pjsip_outbound_registration` silently creates *no* registration objects
  at all while endpoint/aor/auth objects from the same file load fine. See
  `pjsip-transport.conf` for the exact misleading error.
- **The Asterisk control socket needs the systemd drop-in.** The packaged unit
  doesn't apply `asterisk.conf`'s `astctlpermissions`/`astctlgroup` reliably on
  this build, so `/var/run/asterisk/asterisk.ctl` comes back owner-write-only on
  every restart and `potp-agent` can connect but not issue `pjsip reload`. A
  one-off `chmod` is silently undone by the next restart;
  `asterisk.service.d-override.conf` is the fix, and it works because the unit
  is `Type=notify` so `ExecStartPost` runs after the socket exists.
- **The sshd drop-in must sort before `50-`/`60-`.** sshd keeps the *first*
  value it sees per keyword and DigitalOcean's image ships cloud-init drop-ins
  at those numbers. And confirm `opsadmin` can log in and `sudo` before
  reloading sshd, or you lock yourself out — root login is closed.
- **`MEDIA_ROOT` and `MEDIA_MANIFEST_SECRET` are what enable media sync.**
  Without both set in `agent.env`, `media-sync.ts`'s loop simply never runs and
  `voice_challenge` recordings silently never reach the node. `MEDIA_SOUND_PREFIX`
  defaults to `custom/potp` and only needs setting for a different
  sound-search-relative path.
