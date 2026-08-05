import { createServer } from "node:http";
import { Readable } from "node:stream";

import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import {
  CreateVerificationSchema,
  verificationTypes,
  VerificationTypeSchema,
} from "@powerotp/contracts";
import { z } from "zod";

import {
  buildExample,
  getCapabilities,
  integrationOverview,
  verificationGuides,
} from "./content.js";

const config = z
  .object({
    NODE_ENV: z.literal("production"),
    PORT: z.coerce.number().int().positive().default(3002),
  })
  .parse(process.env);

const mcp = new McpServer({
  name: "powerotp-integration-guide",
  version: "0.1.0",
});

mcp.registerResource(
  "integration-overview",
  "powerotp://docs/integration-overview",
  {
    title: "POWEROTP integration overview",
    description: "Server authentication, request creation, status, and response rules.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(integrationOverview, null, 2),
      },
    ],
  }),
);

mcp.registerResource(
  "verification-capabilities",
  "powerotp://docs/capabilities",
  {
    title: "POWEROTP verification capabilities",
    description: "Supported verification methods and lifecycle states.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(getCapabilities(), null, 2),
      },
    ],
  }),
);

mcp.registerTool(
  "list_capabilities",
  {
    title: "List POWEROTP capabilities",
    description: "Return the supported verification methods and lifecycle states.",
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(getCapabilities(), null, 2) }],
  }),
);

mcp.registerTool(
  "get_integration_guide",
  {
    title: "Get a POWEROTP method guide",
    description: "Explain how to integrate one verification method securely.",
    inputSchema: z.object({ type: VerificationTypeSchema }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ type }) => ({
    content: [{ type: "text", text: verificationGuides[type] }],
  }),
);

mcp.registerTool(
  "generate_example",
  {
    title: "Generate a POWEROTP request example",
    description: "Generate a server-side curl or TypeScript example without credentials.",
    inputSchema: z.object({
      type: VerificationTypeSchema,
      language: z.enum(["curl", "typescript"]),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ type, language }) => ({
    content: [{ type: "text", text: buildExample(type, language) }],
  }),
);

mcp.registerTool(
  "validate_request_shape",
  {
    title: "Validate a POWEROTP request shape",
    description:
      "Validate request structure locally. This does not contact a project or send a call/SMS.",
    inputSchema: z.object({ request: z.unknown() }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ request }) => {
    const result = CreateVerificationSchema.safeParse(request);
    const output = result.success
      ? { valid: true, normalized: result.data }
      : { valid: false, issues: result.error.issues };

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    };
  },
);

const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});
await mcp.connect(transport);

async function readRequestBody(request: Readable): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 1_000_000) throw new Error("MCP request exceeds 1 MB");
    chunks.push(buffer);
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

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

  if (url.pathname !== "/mcp") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        value.forEach((item) => headers.append(name, item));
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }

    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await readRequestBody(request);
    const webRequest = new Request(
      new URL(request.url ?? "/mcp", "https://mcp.powerotp.com"),
      {
        method: request.method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
      },
    );
    const webResponse = await transport.handleRequest(webRequest);

    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    if (!webResponse.body) {
      response.end();
      return;
    }

    const reader = webResponse.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      response.write(Buffer.from(value));
    }
    response.end();
  } catch (error) {
    console.error(
      JSON.stringify({
        service: "powerotp-mcp",
        status: "request-error",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    if (!response.headersSent) {
      response.writeHead(400, { "content-type": "application/json" });
    }
    response.end(JSON.stringify({ error: "invalid_mcp_request" }));
  }
});

async function shutdown(signal: string) {
  console.info(JSON.stringify({ service: "powerotp-mcp", signal }));
  await mcp.close();
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
