import { createMcpTransport } from "@powerotp/mcp/mcp-app.js";

/**
 * The public, anonymous, read-only MCP integration guide. `handleRequest`
 * already speaks the standard Fetch API, the same one a Next.js Route
 * Handler receives and returns, so no bridging layer is needed here.
 */
let transportPromise: ReturnType<typeof createMcpTransport> | undefined;

function getTransport() {
  transportPromise ??= createMcpTransport();
  return transportPromise;
}

export async function POST(request: Request) {
  const { transport } = await getTransport();
  return transport.handleRequest(request);
}

export const GET = POST;
export const DELETE = POST;
