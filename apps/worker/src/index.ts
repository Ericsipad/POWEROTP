import { Redis } from "ioredis";
import { MongoClient } from "mongodb";
import { z } from "zod";

const config = z
  .object({
    NODE_ENV: z.literal("production"),
    MONGODB_URI: z.string().startsWith("mongodb"),
    VALKEY_URL: z.string().startsWith("rediss://"),
  })
  .parse(process.env);

const mongo = new MongoClient(config.MONGODB_URI, {
  appName: "powerotp-worker",
  serverSelectionTimeoutMS: 10_000,
});
const valkey = new Redis(config.VALKEY_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

await Promise.all([mongo.connect(), valkey.connect()]);
await Promise.all([mongo.db("admin").command({ ping: 1 }), valkey.ping()]);

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ service: "powerotp-worker", signal }));
  await Promise.allSettled([mongo.close(), valkey.quit()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.info(
  JSON.stringify({
    service: "powerotp-worker",
    status: "ready",
    production: config.NODE_ENV === "production",
  }),
);

setInterval(() => {
  void Promise.all([mongo.db("admin").command({ ping: 1 }), valkey.ping()])
    .then(() => {
      console.info(
        JSON.stringify({
          service: "powerotp-worker",
          status: "ready",
          timestamp: new Date().toISOString(),
        }),
      );
    })
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          service: "powerotp-worker",
          status: "dependency-error",
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    });
}, 60_000).unref();

await new Promise(() => undefined);
