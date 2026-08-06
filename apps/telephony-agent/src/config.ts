import { z } from "zod";

/**
 * Node identity is one shared secret, `NODE_SECRET`, entered once in App
 * Platform (see `docs/AS_BUILT.md`) and identical across every droplet —
 * not a per-node value generated through an admin flow, and not a client
 * certificate (true mutual TLS is not straightforward to terminate on
 * DigitalOcean App Platform's shared ingress). This value is baked into a
 * droplet's deployment once and never edited on the node afterward;
 * rotating it is an App Platform env var edit plus redeploying every node.
 */
const ConfigSchema = z.object({
  NODE_SECRET: z.string().min(32),
  CONTROL_PLANE_URL: z.string().url().startsWith("https://"),
  ARI_URL: z.string().startsWith("http://127.0.0.1").default("http://127.0.0.1:8088"),
  /**
   * Local ARI user/password, generated directly on the droplet at install
   * time and never sent to or stored by the control plane (see
   * `docs/AS_BUILT.md`'s "Telephony droplet" section). Loaded from
   * `/etc/powerotp/ari.env` by the systemd unit's `EnvironmentFile`.
   */
  ARI_USER: z.string().min(1),
  ARI_PASS: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * How often to poll `/v1/nodes/jobs/next` for a call to place — separate
   * from and much faster than `POLL_INTERVAL_MS` (the trunk-config sync
   * interval) since call dispatch needs to happen promptly, not once a
   * minute.
   */
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  /**
   * How long Asterisk lets a `call_reachability` originate ring before
   * giving up (ARI's own `timeout` param on `POST /channels`). Kept short
   * since the only thing being measured is whether the destination
   * answers, not a full IVR interaction.
   */
  CALL_RING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  /**
   * Optional: where to write the rendered PJSIP trunk config on this
   * droplet. Left unset in environments without a local Asterisk install
   * (e.g. running the agent for a config-fetch smoke test), in which case
   * the agent only logs what it received.
   */
  ASTERISK_PJSIP_TRUNKS_PATH: z.string().startsWith("/").optional(),
});

export type AgentConfig = z.infer<typeof ConfigSchema>;

export function loadAgentConfig(environment: NodeJS.ProcessEnv = process.env): AgentConfig {
  return ConfigSchema.parse(environment);
}
