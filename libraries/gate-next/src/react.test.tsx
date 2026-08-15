import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  BOTBLOCKER_PROTOCOL_VERSION,
  type DecisionRevisionEnvelope,
} from "@powerotp/contracts";
import { Window as HappyWindow } from "happy-dom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { withPowerOtpFrameSource } from "./csp.js";
import { PowerOtpNextGate } from "./react.js";

const siteId = "site_1234567890123456";
const audience = "https://customer.example";
const siteCredential = "potp_bb_secret_that_stays_server_side_123456";

test("client entry contains no credential or environment boundary", async () => {
  const source = await readFile(new URL("./react.tsx", import.meta.url), "utf8");
  assert.match(source, /^"use client";/);
  assert.ok(!source.includes("siteCredential"));
  assert.ok(!source.includes("potp_bb_"));
  assert.ok(!source.includes("process.env"));
  assert.match(source, /@powerotp\/gate-node\/browser/);
});

test("Next production client bundles contain no server credential", async () => {
  const staticRoot = new URL("../fixture/.next/static/", import.meta.url);
  const files = await javascriptFiles(staticRoot);
  assert.ok(files.length > 0, "build the Next fixture before running bundle checks");
  const bundle = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.ok(!bundle.includes(siteCredential));
  assert.ok(!bundle.includes("potp_bb_fixture_server_only"));
  assert.ok(!bundle.includes("POWEROTP_SITE_CREDENTIAL"));
});

test("root gate persists through App Router-style history navigation and sequences reports", async () => {
  const window = new HappyWindow({ url: `${audience}/account?secret=discarded` });
  const restoreGlobals = installBrowserGlobals(window);
  const reports: unknown[] = [];
  const calls: string[] = [];
  const fetcher = createFetch(async (path, init) => {
    calls.push(path);
    if (path === "/_powerotp/initial-evidence") return json({ status: "accepted" });
    if (path === "/_powerotp/session") return json(bootstrap(7));
    if (path === "/_powerotp/decision") {
      return json({ status: "decision", candidate: decision("allow", 6) });
    }
    if (path === "/_powerotp/decision/verify") {
      return json({ verified: true, decision: JSON.parse(String(init?.body)).candidate });
    }
    if (path === "/_powerotp/browser-assessment") {
      reports.push(JSON.parse(String(init?.body)));
      return json({ status: "decision", candidate: decision("allow", 7) });
    }
    throw new Error(`Unexpected bridge path ${path}`);
  });
  let root: Root | undefined;

  try {
    const container = window.document.createElement("div");
    window.document.body.append(container);
    root = createRoot(container as unknown as Element);
    await act(async () => {
      root?.render(
        <PowerOtpNextGate
          sensorVersion="next-app-router-v1"
          window={window as unknown as Window}
          document={window.document as unknown as Document}
          fetch={fetcher}
        />,
      );
    });
    await waitFor(() => calls.includes("/_powerotp/decision/verify"));
    window.history.pushState({}, "", "/dashboard?token=discarded#fragment");
    await waitFor(() => reports.length === 1);
    const report = reports[0] as {
      sequence: { sequence: number };
      evidence: { routePath: string };
    };
    assert.equal(report.sequence.sequence, 7);
    assert.equal(report.evidence.routePath, "/account");
    assert.ok(!JSON.stringify(report).includes("secret"));
    assert.ok(!JSON.stringify(report).includes("token"));
  } finally {
    await act(async () => root?.unmount());
    await window.happyDOM.close();
    restoreGlobals();
  }
});

test("verified OTP does not change customer DOM or open an iframe automatically", async () => {
  const window = new HappyWindow({ url: `${audience}/private` });
  const restoreGlobals = installBrowserGlobals(window);
  const calls: string[] = [];
  const fetcher = createFetch(async (path, init) => {
    calls.push(path);
    if (path === "/_powerotp/initial-evidence") return json({ status: "accepted" });
    if (path === "/_powerotp/session") return json(bootstrap(0));
    if (path === "/_powerotp/decision") {
      return json({ status: "decision", candidate: decision("otp", 0) });
    }
    if (path === "/_powerotp/decision/verify") {
      return json({ verified: true, decision: JSON.parse(String(init?.body)).candidate });
    }
    throw new Error(`Unexpected bridge path ${path}`);
  });
  let root: Root | undefined;

  try {
    const container = window.document.createElement("div");
    window.document.body.append(container);
    root = createRoot(container as unknown as Element);
    await act(async () => {
      root?.render(
        <PowerOtpNextGate
          sensorVersion="next-iframe-v1"
          pollIntervalMs={60_000}
          window={window as unknown as Window}
          document={window.document as unknown as Document}
          fetch={fetcher}
        />,
      );
    });
    await waitFor(() => calls.includes("/_powerotp/decision/verify"));
    assert.equal(window.document.querySelector("iframe"), null);
    assert.equal(calls.includes("/_powerotp/challenge/open"), false);
    assert.equal(calls.includes("/_powerotp/challenge/status"), false);
    assert.ok(!window.document.documentElement.textContent?.includes(siteCredential));
  } finally {
    await act(async () => root?.unmount());
    await window.happyDOM.close();
    restoreGlobals();
  }
});

test("CSP helper preserves policy and adds only a trusted iframe origin", () => {
  assert.equal(
    withPowerOtpFrameSource("default-src 'self'; frame-src 'none';", "https://verify.powerotp.com"),
    "default-src 'self'; frame-src https://verify.powerotp.com;",
  );
  assert.throws(
    () => withPowerOtpFrameSource("default-src 'self'", "https://attacker.example"),
    /POWEROTP-hosted/,
  );
});

function bootstrap(startingSequence: number) {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId,
    audience,
    gateSessionId: gateSessionId(),
    startingSequence,
    decisionTimeoutMs: 200,
  };
}

function gateSessionId(): string {
  return "gate_session_123456789";
}

function decision(outcome: "allow" | "otp", sequence: number): DecisionRevisionEnvelope {
  return {
    protocolVersion: BOTBLOCKER_PROTOCOL_VERSION,
    siteId,
    sequence: { gateSessionId: gateSessionId(), sequence, issuedAt: Date.now() },
    outcome,
    audience,
    nonce: `decision_${outcome}_${sequence.toString().padStart(8, "0")}`,
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

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
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
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

async function javascriptFiles(root: URL): Promise<URL[]> {
  const files: URL[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, root);
    if (entry.isDirectory()) files.push(...await javascriptFiles(child));
    else if (entry.name.endsWith(".js")) files.push(child);
  }
  return files;
}
