import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import {
  createPowerOtpBotBlocker,
  type PowerOtpRequest,
} from "@powerotp/gate-express";
import { createPowerOtpRequestListener } from "@powerotp/gate-node";
import express from "express";
import { NextRequest } from "next/server";

import { createPowerOtpNext } from "./adapter.js";

const siteId = "site_1234567890123456";
const audience = "https://customer.example";
const siteCredential = "potp_bb_secret_that_stays_server_side_123456";
const keyPair = generateKeyPairSync("ed25519");
const verificationKeys = {
  active: { keyId: "key_1234567890123456", publicKey: keyPair.publicKey },
};

test("raw Node, Express, and Next expose the same shared advisory state", async () => {
  const raw = createServer(createPowerOtpRequestListener({
    ...options(),
    handle(_request, response, state) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(state));
    },
  }));
  const app = express();
  const gate = createPowerOtpBotBlocker(options());
  app.use(gate.middleware());
  app.use((request, response) => response.json((request as PowerOtpRequest).powerOtp));
  const expressServer = createServer(app);
  const next = createPowerOtpNext(options());

  try {
    const [rawOrigin, expressOrigin] = await Promise.all([listen(raw), listen(expressServer)]);
    for (const path of ["/private", "/health"]) {
      const rawState = await (await fetch(`${rawOrigin}${path}`)).json();
      const expressState = await (await fetch(`${expressOrigin}${path}`)).json();
      const response = await next.proxy(
        new NextRequest(`${audience}${path}`),
        { waitUntil() {} } as never,
      );
      const nextState = next.getRequestState({
        get(name) {
          return response.headers.get(`x-middleware-request-${name}`);
        },
      });
      assert.deepEqual(withoutSession(expressState), withoutSession(rawState), path);
      assert.deepEqual(withoutSession(nextState), withoutSession(rawState), path);
    }
  } finally {
    await Promise.all([close(raw), close(expressServer)]);
  }
});

function options() {
  return {
    siteId,
    audience,
    siteCredential,
    verificationKeys,
  };
}

function withoutSession(value: Record<string, unknown>) {
  const { sessionId: _sessionId, ...state } = value;
  return state;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
