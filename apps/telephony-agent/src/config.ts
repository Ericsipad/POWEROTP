import { z } from "zod";

/**
 * Node identity is a single hashed-at-rest bearer secret issued by
 * `POST /v1/admin/nodes` (see `docs/AS_BUILT.md`), not a client
 * certificate: true mutual TLS is not straightforward to terminate on
 * DigitalOcean App Platform's shared ingress, so the droplet
 * authenticates back to the control plane the same way a customer server
 * authenticates to the verification API.
 */
const ConfigSchema = z.object({
  NODE_SECRET: z.string().min(32),
  CONTROL_PLANE_URL: z.string().url().startsWith("https://"),
  ARI_URL: z.string().startsWith("http://127.0.0.1").default("http://127.0.0.1:8088"),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
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
