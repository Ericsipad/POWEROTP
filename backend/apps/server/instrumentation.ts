/**
 * Next.js calls this once when the server process starts, before it
 * accepts requests. Used to fail fast on invalid configuration and start
 * the durable background workers immediately, rather than lazily on the
 * first API request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getServerContext } = await import("@/lib/server-context");
  await getServerContext();
}
