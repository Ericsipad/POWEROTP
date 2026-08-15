import { Readable } from "node:stream";

import {
  createMemoryGateSessionStore,
  createPowerOtpRequestListener,
  type GateNodeOptions,
  type GateSessionStore,
  type ProtectedRequestState,
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
}

export function createPowerOtpNext(options: GateNextOptions): PowerOtpNextAdapter {
  const store = options.sessionStore ?? createMemoryGateSessionStore();
  const continuations = new WeakMap<object, (state: ProtectedRequestState) => void>();
  const listener = createPowerOtpRequestListener({
    ...options,
    sessionStore: store,
    handle(request, _response, state) {
      continuations.get(request)?.(state);
    },
  });

  async function run(request: NextRequest, includeBody: boolean): Promise<RunResult> {
    let state: ProtectedRequestState | undefined;
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

      if (result.state.protected && result.state.sessionId) {
        event.waitUntil(
          Promise.resolve(store.get(result.state.sessionId))
            .then((session) => session?.pendingDecision)
            .then(() => undefined),
        );
      }
      const response = NextResponse.next();
      result.response.copyHeadersTo(response.headers);
      return response;
    },
    async route(request) {
      return (await run(request, true)).response.toResponse(request.method);
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
  state?: ProtectedRequestState;
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
