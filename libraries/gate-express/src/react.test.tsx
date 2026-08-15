import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";

import {
  BOTBLOCKER_PROTOCOL_VERSION,
  type DecisionRevisionEnvelope,
} from "@powerotp/contracts";
import { Window as HappyWindow } from "happy-dom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  createGateExpressFixture,
  GateExpressReactFixture,
} from "./fixture.js";

const siteId = "site_1234567890123456";
const audience = "https://customer.example";
const siteCredential = "potp_bb_secret_that_stays_server_side_123456";
const keyPair = generateKeyPairSync("ed25519");
const verificationKeys = {
  active: { keyId: "key_1234567890123456", publicKey: keyPair.publicKey },
};
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

test("minimal React fixture serves protected markup and excluded assets", async () => {
  const app = createGateExpressFixture({
    siteId,
    audience,
    siteCredential,
    verificationKeys,
  });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  const page = await fetch(`${origin}/`);
  const markup = await page.text();
  assert.equal(page.status, 200);
  assert.match(markup, /data-powerotp-react-fixture="true"/);
  assert.match(markup, /POWEROTP Express React fixture/);
  assert.ok(!markup.includes(siteCredential));
  assert.ok(!markup.includes("potp_bb_"));

  const asset = await fetch(`${origin}/assets/fixture.txt`);
  assert.equal(await asset.text(), "fixture asset");
  assert.equal(asset.headers.getSetCookie().length, 0);
});

test("browser entry has no credential or environment boundary", async () => {
  const source = await readFile(new URL("./react.tsx", import.meta.url), "utf8");
  assert.ok(!source.includes("siteCredential"));
  assert.ok(!source.includes("potp_bb_"));
  assert.ok(!source.includes("process.env"));
  assert.match(source, /@powerotp\/gate-node\/browser/);
});

test("React root starts the trusted bridge sensor and applies decision revisions", async () => {
  const window = new HappyWindow({ url: `${audience}/` });
  const restoreGlobals = installBrowserGlobals(window);
  let root: Root | undefined;
  const reports: unknown[] = [];
  const calls: Array<{ path: string; marker: string | null }> = [];
  const fetcher = createFetch(async (path, init) => {
    calls.push({
      path,
      marker: new Headers(init?.headers).get("x-powerotp-bridge"),
    });
    if (path === "/_powerotp/session") {
      return json({
        protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
        siteId,
        audience,
        gateSessionId: "gate_session_123456789",
        startingSequence: 7,
        decisionTimeoutMs: 200,
      });
    }
    if (path === "/_powerotp/decision") {
      return json({ status: "decision", candidate: decision(6) });
    }
    if (path === "/_powerotp/decision/verify") {
      return json({
        verified: true,
        decision: JSON.parse(String(init?.body)).candidate,
      });
    }
    if (path === "/_powerotp/browser-assessment") {
      reports.push(JSON.parse(String(init?.body)));
      return json({ status: "decision", candidate: decision(7) });
    }
    throw new Error(`Unexpected bridge path ${path}`);
  });

  try {
    const container = window.document.createElement("div");
    window.document.body.append(container);
    root = createRoot(container as unknown as Element);
    await act(async () => {
      root?.render(
        <GateExpressReactFixture
          sensorVersion="express-react-v1"
          window={window as unknown as Window}
          document={window.document as unknown as Document}
          fetch={fetcher}
        />,
      );
    });
    assert.match(container.textContent ?? "", /POWEROTP Express React fixture/);
    await waitFor(
      () => calls.filter((call) => call.path === "/_powerotp/decision/verify").length >= 1,
    );

    window.history.pushState({}, "", "/next?secret=discarded");
    await waitFor(() => reports.length === 1);
    const report = reports[0] as {
      sequence: { sequence: number };
      evidence: { routePath: string };
    };
    assert.equal(report.sequence.sequence, 7);
    assert.equal(report.evidence.routePath, "/");
    assert.ok(calls.every((call) => call.marker === "1"));
  } finally {
    await act(async () => root?.unmount());
    await window.happyDOM.close();
    restoreGlobals();
  }
});

function decision(sequence: number): DecisionRevisionEnvelope {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId,
    sequence: {
      gateSessionId: "gate_session_123456789",
      sequence,
      issuedAt: Date.now(),
    },
    outcome: "allow",
    audience,
    nonce: `decision_nonce_${sequence.toString().padStart(8, "0")}`,
    expiresAt: Date.now() + 60_000,
  };
}

function createFetch(
  handler: (path: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const value = typeof input === "string" ? input : input.toString();
    return handler(new URL(value, audience).pathname, init);
  }) as typeof fetch;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for browser gate state");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function installBrowserGlobals(window: HappyWindow): () => void {
  const values = {
    window: window as unknown as Window,
    document: window.document as unknown as Document,
    navigator: window.navigator as unknown as Navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}
