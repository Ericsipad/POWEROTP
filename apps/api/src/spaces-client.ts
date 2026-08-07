import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { ProductionConfig } from "./config.js";

export interface SpacesClient {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  presignedGetUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

type SpacesConfig = Pick<
  ProductionConfig,
  "SPACES_ENDPOINT" | "SPACES_BUCKET" | "SPACES_ACCESS_KEY" | "SPACES_SECRET_KEY"
>;

/**
 * Thin wrapper over DigitalOcean Spaces' S3-compatible API — the only
 * storage for `voice_challenge` recording bytes; Mongo holds metadata and
 * checksums only (see `apps/api/src/challenge-persistence.ts`). Returns
 * `undefined` until all four dedicated variables are configured, the same
 * "code-complete but fails closed without live credentials" convention as
 * `apps/api/src/sms.ts`'s VoIP.ms adapter.
 */
export function createSpacesClient(config: SpacesConfig): SpacesClient | undefined {
  const { SPACES_ENDPOINT, SPACES_BUCKET, SPACES_ACCESS_KEY, SPACES_SECRET_KEY } = config;
  if (!SPACES_ENDPOINT || !SPACES_BUCKET || !SPACES_ACCESS_KEY || !SPACES_SECRET_KEY) {
    return undefined;
  }

  const client = new S3Client({
    endpoint: SPACES_ENDPOINT,
    // Spaces ignores the region value but the SDK requires one to be set.
    region: "us-east-1",
    credentials: { accessKeyId: SPACES_ACCESS_KEY, secretAccessKey: SPACES_SECRET_KEY },
  });

  return {
    async putObject(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: SPACES_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
          ACL: "private",
        }),
      );
    },
    async presignedGetUrl(key, expiresInSeconds = 600) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
  };
}
