import { z } from "zod";

const ProductionConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  MONGODB_URI: z.string().startsWith("mongodb"),
  VALKEY_URL: z.string().startsWith("rediss://"),
  INTERACTION_TOKEN_SECRET: z.string().min(32),
  CONFIG_ENCRYPTION_KEY: z.string().min(32),
  PUBLIC_API_URL: z.string().url(),
});

export type ProductionConfig = z.infer<typeof ProductionConfigSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProductionConfig {
  return ProductionConfigSchema.parse(environment);
}
