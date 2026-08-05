import { z } from "zod";

const config = z
  .object({
    NODE_ENV: z.literal("production"),
    NODE_ID: z.string().uuid(),
    CONTROL_PLANE_URL: z.string().url().startsWith("https://"),
    MTLS_CERT_PATH: z.string().startsWith("/"),
    MTLS_KEY_PATH: z.string().startsWith("/"),
    ARI_URL: z.string().startsWith("http://127.0.0.1"),
  })
  .parse(process.env);

console.info(
  JSON.stringify({
    service: "powerotp-telephony-agent",
    nodeId: config.NODE_ID,
    status: "configuration-valid",
  }),
);

// Node enrollment, leases, and local ARI control are implemented in Phase 4.
