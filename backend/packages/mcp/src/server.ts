import { createServer } from "node:http";

import { verificationTypes } from "@powerotp/contracts";
import { z } from "zod";

import { createMcpHandler } from "./mcp-app.js";

/**
 * Standalone bootstrap for local development only. In production this
 * logic is embedded in the backend Next.js component at
 * `backend/apps/server/app/mcp/route.ts`. The frontend is a separate
 * DigitalOcean component; MCP is not deployed as a third service.
 */
const config = z
  .object({
    PORT: z.coerce.number().int().positive().default(3002),
    PUBLIC_APP_URL: z.string().url().default("http://localhost:3002"),
  })
  .parse(process.env);

const mcpHandler = await createMcpHandler(config.PUBLIC_APP_URL);

const httpServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/health" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        service: "powerotp-mcp",
        status: "ok",
        public: true,
        readOnly: true,
        projectAware: false,
      }),
    );
    return;
  }

  await mcpHandler.handleHttp(request, response);
});

async function shutdown(signal: string) {
  console.info(JSON.stringify({ service: "powerotp-mcp", signal }));
  await mcpHandler.close();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

httpServer.listen(config.PORT, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      service: "powerotp-mcp",
      status: "ready",
      port: config.PORT,
      verificationTypes,
    }),
  );
});
