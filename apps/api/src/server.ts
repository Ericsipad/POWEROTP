import { buildApp } from "./app.js";
import { AuthService } from "./auth-service.js";
import { loadConfig } from "./config.js";
import { connectDataStores } from "./dependencies.js";
import { createBrevoEmailService } from "./email.js";
import { ensureIndexes } from "./persistence.js";
import { ProjectService } from "./project-service.js";

const config = loadConfig();
const dataStores = await connectDataStores(config);
await ensureIndexes(dataStores.db);
const auth = new AuthService(
  dataStores.db,
  config,
  createBrevoEmailService(config),
);
const projects = new ProjectService(dataStores.db, config);
const app = buildApp(dataStores, { auth, config, projects });

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
