const configuredApiBase = process.env.NEXT_PUBLIC_API_URL?.trim();
const apiBase =
  configuredApiBase ||
  (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3001");

function requireApiBase(): string {
  if (!apiBase) {
    throw new Error("NEXT_PUBLIC_API_URL is required in production");
  }
  return apiBase;
}

export function apiUrl(path: string): string {
  return buildApiUrl(path, requireApiBase());
}

export function buildApiUrl(path: string, base: string): string {
  if (!path.startsWith("/")) {
    throw new Error("API paths must begin with '/'");
  }
  return new URL(path, base).toString();
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: init.credentials ?? "include",
  });
}
