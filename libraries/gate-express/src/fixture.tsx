import type { GateNodeServices } from "@powerotp/gate-node";
import express, { type Express } from "express";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createPowerOtpBotBlocker,
  type GateExpressOptions,
} from "./middleware.js";
import {
  PowerOtpBrowserGate,
  type PowerOtpBrowserGateProps,
} from "./react.js";

export function GateExpressReactFixture(
  props: PowerOtpBrowserGateProps,
) {
  return (
    <>
      <PowerOtpBrowserGate {...props} />
      <main data-powerotp-react-fixture="true">
        <h1>POWEROTP Express React fixture</h1>
      </main>
    </>
  );
}

export function createGateExpressFixture(options: {
  siteId: string;
  siteCredential: string;
  audience: string;
  verificationKeys: GateExpressOptions["verificationKeys"];
  services?: Partial<GateNodeServices>;
}): Express {
  const app = express();
  const gate = createPowerOtpBotBlocker({
    ...options,
    cookieSecure: false,
    protect: ({ path }) => path === "/" || path.startsWith("/api/"),
  });

  app.use(gate.middleware());
  app.get("/assets/fixture.txt", (_request, response) => {
    response.type("text/plain").send("fixture asset");
  });
  app.get("/api/fixture", (_request, response) => {
    response.json({ fixture: "gate-express-api" });
  });
  app.get("/", (_request, response) => {
    const markup = renderToStaticMarkup(
      <GateExpressReactFixture sensorVersion="fixture-v1" />,
    );
    response.type("html").send(`<!doctype html>${markup}`);
  });
  return app;
}
