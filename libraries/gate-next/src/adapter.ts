import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

import {
  type AdvisoryRequestState,
  createMemoryGateSessionStore,
  createPowerOtpRequestListener,
  type GateNodeOptions,
  type GateSessionStore,
} from "@powerotp/gate-node";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

export type GateNextOptions = Omit<GateNodeOptions, "handle" | "sessionStore"> & {
  sessionStore?: GateSessionStore;
  /**
   * NextRequest has no socket address. Supply only a platform-authenticated direct peer
   * address. Forwarded headers remain subject to trustedProxy validation.
   */
  resolveDirectAddress?: (request: NextRequest) => string | undefined;
};

export interface PowerOtpNextAdapter {
  proxy(request: NextRequest, event: NextFetchEvent): Promise<Response>;
  route(request: NextRequest): Promise<Response>;
  getRequestState(headers: PowerOtpRequestHeaders): AdvisoryRequestState;
}

export interface PowerOtpRequestHeaders {
  get(name: string): string | null;
}

const REQUEST_STATE_HEADER = "x-powerotp-request-state";

export function createPowerOtpNext(options: GateNextOptions): PowerOtpNextAdapter {
  const store = options.sessionStore ?? createMemoryGateSessionStore();
  const continuations = new WeakMap<object, (state: AdvisoryRequestState) => void>();
  const listener = createPowerOtpRequestListener({
    ...options,
    sessionStore: store,
    handle(request, _response, state) {
      continuations.get(request)?.(state);
    },
  });

  async function run(request: NextRequest, includeBody: boolean): Promise<RunResult> {
    let state: AdvisoryRequestState | undefined;
    const response = new NodeResponseCapture();
    const directAddress = options.resolveDirectAddress?.(request);
    const incoming = toIncomingRequest(request, includeBody, directAddress);
    continuations.set(incoming, (value) => {
      state = value;
    });
    try {
      await (listener as unknown as (
        request: ReturnType<typeof toIncomingRequest>,
        response: NodeResponseCapture,
      ) => Promise<void>)(incoming, response);
      return { response, state };
    } finally {
      continuations.delete(incoming);
    }
  }

  return {
    async proxy(request, event) {
      if (isWebSocketUpgrade(request)) return NextResponse.next();
      const result = await run(request, false);
      if (!result.state) return result.response.toResponse(request.method);

      if (result.state.advisory && result.state.sessionId) {
        event.waitUntil(
          Promise.resolve(store.get(result.state.sessionId))
            .then((session) => session?.pendingDecision)
            .then(() => undefined),
        );
      }
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set(
        REQUEST_STATE_HEADER,
        encodeRequestState(result.state, options.siteCredential),
      );
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      result.response.copyHeadersTo(response.headers);
      return response;
    },
    async route(request) {
      return (await run(request, true)).response.toResponse(request.method);
    },
    getRequestState(headers) {
      return decodeRequestState(
        headers.get(REQUEST_STATE_HEADER),
        options.siteCredential,
      );
    },
  };
}

function encodeRequestState(state: AdvisoryRequestState, credential: string): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const signature = signRequestState(payload, credential);
  return `${payload}.${signature}`;
}

function decodeRequestState(
  value: string | null,
  credential: string,
): AdvisoryRequestState {
  if (!value || value.length > 8_192) return unavailableRequestState();
  try {
    const parts = value.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return unavailableRequestState();
    const expected = Buffer.from(signRequestState(parts[0], credential), "base64url");
    const supplied = Buffer.from(parts[1], "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return unavailableRequestState();
    }
    const parsed: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return isAdvisoryRequestState(parsed) ? parsed : unavailableRequestState();
  } catch {
    return unavailableRequestState();
  }
}

function signRequestState(payload: string, credential: string): string {
  return createHmac("sha256", credential).update(payload).digest("base64url");
}

function isAdvisoryRequestState(value: unknown): value is AdvisoryRequestState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (state.advisory === false) {
    return state.status === "excluded" && Object.keys(state).length === 2;
  }
  if (
    state.advisory !== true ||
    !["checking", "clearance", "fail_open", "offline", "allow", "otp", "unavailable"].includes(
      String(state.status),
    ) ||
    !isRecommendation(state.recommendation)
  ) {
    return false;
  }
  return state.sessionId === undefined || typeof state.sessionId === "string";
}

function isRecommendation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    ["checking", "fail_open", "offline", "unavailable", "observing", "otp_required", "verified"].includes(
      String(snapshot.lifecycle),
    ) &&
    ["restricted", "full_access", "otp_required"].includes(String(snapshot.recommendation)) &&
    typeof snapshot.decisionPending === "boolean" &&
    typeof snapshot.otpOpen === "boolean"
  );
}

function unavailableRequestState(): AdvisoryRequestState {
  return {
    advisory: true,
    status: "unavailable",
    recommendation: {
      lifecycle: "unavailable",
      recommendation: "full_access",
      decisionPending: false,
      otpOpen: false,
    },
  };
}

function isWebSocketUpgrade(request: NextRequest): boolean {
  return (
    request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
    request.headers
      .get("connection")
      ?.split(",")
      .some((token) => token.trim().toLowerCase() === "upgrade") === true
  );
}

interface RunResult {
  response: NodeResponseCapture;
  state?: AdvisoryRequestState;
}

function toIncomingRequest(
  request: NextRequest,
  includeBody: boolean,
  directAddress: string | undefined,
) {
  const source =
    includeBody && request.body
      ? Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0])
      : Readable.from([]);
  const headers: Record<string, string> = {};
  const rawHeaders: string[] = [];
  request.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
    rawHeaders.push(name, value);
  });
  return Object.assign(source, {
    method: request.method,
    url: `${request.nextUrl.pathname}${request.nextUrl.search}`,
    headers,
    rawHeaders,
    socket: { remoteAddress: directAddress },
  });
}

class NodeResponseCapture {
  headersSent = false;
  statusCode = 200;
  destroyed = false;
  private readonly headers = new Map<string, string | string[]>();
  private readonly chunks: Uint8Array[] = [];

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(
      name.toLowerCase(),
      Array.isArray(value) ? value.map(String) : String(value),
    );
    return this;
  }

  getHeader(name: string): string | string[] | undefined {
    return this.headers.get(name.toLowerCase());
  }

  writeHead(
    status: number,
    headers?: Record<string, string | number | readonly string[]>,
  ): this {
    this.statusCode = status;
    if (headers) {
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    }
    this.headersSent = true;
    return this;
  }

  end(value?: string | Uint8Array): this {
    if (value !== undefined) {
      this.chunks.push(typeof value === "string" ? Buffer.from(value) : value);
    }
    this.headersSent = true;
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }

  copyHeadersTo(target: Headers): void {
    for (const [name, value] of this.headers) {
      if (Array.isArray(value)) {
        for (const item of value) target.append(name, item);
      } else {
        target.set(name, value);
      }
    }
  }

  toResponse(method: string): Response {
    const headers = new Headers();
    this.copyHeadersTo(headers);
    const body = Buffer.concat(this.chunks.map((chunk) => Buffer.from(chunk)));
    return new Response(method === "HEAD" ? null : body, {
      status: this.destroyed ? 500 : this.statusCode,
      headers,
    });
  }
}
