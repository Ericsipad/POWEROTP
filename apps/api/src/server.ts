import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectDataStores } from "./dependencies.js";

const config = loadConfig();
const dataStores = await connectDataStores(config);
const app = buildApp(dataStores);

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await dataStores.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: "0.0.0.0", port: config.PORT });
} catch (error) {
  app.log.error(error);
  await dataStores.close();
  process.exit(1);
}
