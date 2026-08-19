import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createGzip } from "node:zlib";

import type { RequestContext } from "@powerotp/contracts";
import { createMemoryGateSessionStore } from "@powerotp/gate-node";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";

import {
  createPowerOtpBotBlocker,
  type GateExpressOptions,
  type PowerOtpRequest,
} from "./index.js";

const siteId = "site_1234567890123456";
const webhookId = `bwh_${"A".repeat(120)}.${"B".repeat(43)}`;
const audience = "https://customer.example";
const siteCredential = "potp_bb_secret_that_stays_server_side_123456";
const keyPair = generateKeyPairSync("ed25519");
const verificationKeys = {
  active: { keyId: "key_1234567890123456", publicKey: keyPair.publicKey },
};
const servers: Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("middleware runs before static, SSR, API, and React handlers", async () => {
  const root = await mkdtemp(join(tmpdir(), "powerotp-express-"));
  temporaryDirectories.push(root);
  await writeFile(join(root, "customer.txt"), "customer static");
  const { origin } = await start(
    {},
    (app) => {
      app.use("/files", express.static(root, { setHeaders: addGateStateHeader }));
      app.get("/ssr", stateHandler("ssr"));
      app.get("/api/data", stateHandler("api"));
      app.get("/", stateHandler("react"));
    },
  );

  for (const [path, body] of [
    ["/files/customer.txt", "customer static"],
    ["/ssr", "ssr"],
    ["/api/data", "api"],
    ["/", "react"],
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.headers.get("x-powerotp-status"), "checking");
    assert.equal(await response.text(), body);
  }
});

test("health, static, infrastructure, and OPTIONS paths are non-overridable exclusions", async () => {
  const { origin } = await start(
    {},
    (app) => app.use(stateJsonHandler),
  );

  for (const path of [
    "/health",
    "/.well-known/health/live",
    "/_next/app.js",
    "/assets/logo.svg",
    "/static/app.css",
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal((await response.json()).status, "excluded");
  }
  const options = await fetch(`${origin}/private`, { method: "OPTIONS" });
  assert.equal((await options.json()).status, "excluded");
});

test("direct socket IP is authoritative and spoofed forwarding headers are ignored", async () => {
  const store = createMemoryGateSessionStore();
  const { origin } = await start(
    { sessionStore: store },
    (app) => app.use(stateJsonHandler),
  );
  const response = await fetch(`${origin}/private`, {
    headers: {
      "x-forwarded-for": "198.51.100.10",
      "x-real-ip": "198.51.100.11",
    },
  });
  assert.equal((await storedContext(response, store))?.clientIp, "127.0.0.1");
});

test("trusted proxy header, count, and first/last selection are explicit", async () => {
  for (const [header, select, expectedProxyCount, value, expected] of [
    ["x-forwarded-for", "first", 2, "198.51.100.1, 198.51.100.2", "198.51.100.1"],
    ["x-forwarded-for", "last", 2, "198.51.100.1, 198.51.100.2", "198.51.100.2"],
    ["x-real-ip", "first", 1, "198.51.100.3", "198.51.100.3"],
  ] as const) {
    const store = createMemoryGateSessionStore();
    const { origin, server } = await start(
      {
        sessionStore: store,
        trustedProxy: {
          header,
          select,
          expectedProxyCount,
          trustedRemoteAddresses: ["127.0.0.1"],
        },
      },
      (app) => app.use(stateJsonHandler),
    );
    const response = await fetch(`${origin}/private`, { headers: { [header]: value } });
    const context = await storedContext(response, store);
    assert.equal(context?.clientIp, expected);
    await closeServer(server);
  }
});

test("proxy count mismatch and untrusted proxy forwarding are never accepted", async () => {
  for (const trustedRemoteAddresses of [["127.0.0.1"], ["203.0.113.10"]]) {
    const store = createMemoryGateSessionStore();
    const { origin, server } = await start(
      {
        sessionStore: store,
        trustedProxy: {
          header: "x-forwarded-for",
          select: "first",
          expectedProxyCount: 2,
          trustedRemoteAddresses,
        },
      },
      (app) => app.use(stateJsonHandler),
    );
    const response = await fetch(`${origin}/private`, {
      headers: { "x-forwarded-for": "198.51.100.50" },
    });
    const context = await storedContext(response, store);
    assert.equal(
      context?.clientIp,
      trustedRemoteAddresses[0] === "127.0.0.1" ? undefined : "127.0.0.1",
    );
    await closeServer(server);
  }
});

test("customer handlers continue before pending or failing first-contact services", async () => {
  const failures = [
    () => new Promise<never>(() => undefined),
    () => Promise.reject(new Error("unavailable")),
    () => {
      throw new Error("unavailable");
    },
  ];
  for (const requestDecision of failures) {
    const { origin, server } = await start(
      {
        decisionTimeoutMs: 2_000,
        services: { submitReport: requestDecision },
      },
      (app) => app.use(stateJsonHandler),
    );
    const response = await Promise.race([
      fetch(`${origin}/private`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Express response was delayed")), 250),
      ),
    ]);
    assert.equal((await response.json()).status, "checking");
    await closeServer(server);
  }
});

test("JSON and multipart uploads pass through without body consumption", async () => {
  const { origin } = await start(
    {},
    (app) => {
      app.post("/upload", express.raw({ type: "*/*", limit: "1mb" }), (request, response) => {
        response.json({
          bytes: Buffer.isBuffer(request.body) ? request.body.length : -1,
          status: (request as PowerOtpRequest).powerOtp?.status,
        });
      });
    },
  );
  const json = await fetch(`${origin}/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ private: "customer body" }),
  });
  assert.deepEqual(await json.json(), { bytes: 27, status: "checking" });

  const boundary = "powerotp-test-boundary";
  const multipartBody =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n` +
    "Content-Type: text/plain\r\n\r\ncustomer upload\r\n" +
    `--${boundary}--\r\n`;
  const multipart = await fetch(`${origin}/upload`, {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: multipartBody,
  });
  assert.deepEqual(await multipart.json(), {
    bytes: Buffer.byteLength(multipartBody),
    status: "checking",
  });
});

test("streaming and compressed responses are not buffered or rewritten", async () => {
  const { origin } = await start(
    {
      services: { submitReport: () => new Promise<never>(() => undefined) },
    },
    (app) => {
      app.get("/stream", (_request, response) => {
        response.write("first");
        setTimeout(() => response.end("-second"), 10);
      });
      app.get("/compressed", (_request, response) => {
        response.setHeader("content-encoding", "gzip");
        response.setHeader("content-type", "text/html");
        const gzip = createGzip();
        gzip.pipe(response);
        gzip.end("<main>compressed React HTML</main>");
      });
    },
  );
  const startedAt = Date.now();
  const firstChunk = await firstResponseChunk(`${origin}/stream`);
  assert.equal(firstChunk, "first");
  assert.ok(Date.now() - startedAt < 250);

  const compressed = await fetch(`${origin}/compressed`);
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.equal(await compressed.text(), "<main>compressed React HTML</main>");
});

test("downstream errors before and after headers remain Express-owned", async () => {
  let sawBeforeHeaders = false;
  let sawAfterHeaders = false;
  const errorHandler: ErrorRequestHandler = (_error, _request, response, next) => {
    if (response.headersSent) {
      sawAfterHeaders = true;
      response.destroy();
      return;
    }
    sawBeforeHeaders = true;
    response.status(503).json({ status: "application_error" });
    next();
  };
  const { origin } = await start(
    {},
    (app) => {
      app.get("/before", () => {
        throw new Error("before headers");
      });
      app.get("/after", (_request, response) => {
        response.write("partial");
        throw new Error("after headers");
      });
      app.use(errorHandler);
    },
  );
  const before = await fetch(`${origin}/before`);
  assert.equal(before.status, 503);
  assert.deepEqual(await before.json(), { status: "application_error" });
  await assert.rejects(fetch(`${origin}/after`));
  assert.equal(sawBeforeHeaders, true);
  assert.equal(sawAfterHeaders, true);
});

test("WebSocket upgrades bypass Express advisory interception", async () => {
  const app = express();
  const gate = createPowerOtpBotBlocker(baseOptions({}));
  app.use(gate.middleware());
  const server = createServer(app);
  servers.push(server);
  server.on("upgrade", (_request, socket) => {
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
  });
  const origin = await listen(server);
  const port = Number(new URL(origin).port);
  const response = await websocketHandshake(port);
  assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/);
});

test("router API provides the same root-mounted protocol behavior", async () => {
  const app = express();
  const gate = createPowerOtpBotBlocker(baseOptions({}));
  app.use(gate.router());
  app.use(stateJsonHandler);
  const server = createServer(app);
  servers.push(server);
  const origin = await listen(server);
  const response = await fetch(`${origin}/private`);
  const state = await response.json();
  assert.equal(state.status, "checking");
  assert.equal(state.recommendation.lifecycle, "checking");
  assert.equal(state.recommendation.recommendation, "restricted");
});

async function start(
  overrides: Partial<GateExpressOptions>,
  configure: (app: Express) => void,
) {
  const app = express();
  const gate = createPowerOtpBotBlocker(baseOptions(overrides));
  app.use(gate.middleware());
  configure(app);
  const server = createServer(app);
  servers.push(server);
  return { origin: await listen(server), server };
}

function baseOptions(
  overrides: Partial<GateExpressOptions>,
): GateExpressOptions {
  return {
    siteId,
    webhookId,
    audience,
    siteCredential,
    verificationKeys,
    decisionTimeoutMs: 50,
    ...overrides,
  };
}

function stateHandler(body: string) {
  return (request: Request, response: Response) => {
    response.setHeader(
      "x-powerotp-status",
      (request as PowerOtpRequest).powerOtp?.status ?? "missing",
    );
    response.send(body);
  };
}

function addGateStateHeader(response: Response): void {
  const request = response.req as PowerOtpRequest;
  response.setHeader("x-powerotp-status", request.powerOtp?.status ?? "missing");
}

function stateJsonHandler(request: Request, response: Response): void {
  response.json((request as PowerOtpRequest).powerOtp);
}

function unavailable() {
  return {
    status: "unavailable" as const,
    reason: "not_implemented" as const,
    message: "This service is not available",
    retryable: false,
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  const index = servers.indexOf(server);
  if (index >= 0) servers.splice(index, 1);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function storedContext(
  response: globalThis.Response,
  store: ReturnType<typeof createMemoryGateSessionStore>,
): Promise<RequestContext | undefined> {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("powerotp_gate="));
  assert.ok(cookie);
  const sessionId = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"));
  return (await store.get(sessionId))?.requestContext;
}

async function firstResponseChunk(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      response.once("data", (chunk) => {
        resolve(String(chunk));
        request.destroy();
      });
    });
    request.once("error", reject);
  });
}

async function websocketHandshake(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        "GET /socket HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
    });
    let value = "";
    socket.on("data", (chunk) => {
      value += String(chunk);
    });
    socket.on("end", () => resolve(value));
    socket.on("error", reject);
  });
}
