import { Redis } from "ioredis";
import { type Db, MongoClient } from "mongodb";

import type { ProductionConfig } from "./config.js";

export interface DataStores {
  db: Db;
  rateLimitStore: Redis;
  isReady(): Promise<boolean>;
  close(): Promise<void>;
}

export async function connectDataStores(
  config: Pick<ProductionConfig, "MONGODB_URI" | "VALKEY_URL">,
): Promise<DataStores> {
  const mongo = new MongoClient(config.MONGODB_URI, {
    appName: "powerotp-api",
    serverSelectionTimeoutMS: 10_000,
  });
  const valkey = new Redis(config.VALKEY_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });

  try {
    await Promise.all([mongo.connect(), valkey.connect()]);
    await Promise.all([mongo.db("admin").command({ ping: 1 }), valkey.ping()]);
  } catch (error) {
    await Promise.allSettled([mongo.close(), valkey.quit()]);
    throw error;
  }

  return {
    db: mongo.db("powerotp"),
    rateLimitStore: valkey,
    async isReady() {
      try {
        await Promise.all([mongo.db("admin").command({ ping: 1 }), valkey.ping()]);
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await Promise.allSettled([mongo.close(), valkey.quit()]);
    },
  };
}
