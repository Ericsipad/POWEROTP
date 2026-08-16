import type { BotBlockerVerificationKeySet } from "@powerotp/botblocker-signing";

import { createPowerOtpServer } from "./server.js";
import type { GateNodeServices } from "./types.js";

export function createGateNodeFixture(options: {
  siteId: string;
  webhookId: string;
  siteCredential: string;
  audience: string;
  verificationKeys: BotBlockerVerificationKeySet;
  services?: Partial<GateNodeServices>;
}) {
  return createPowerOtpServer({
    ...options,
    cookieSecure: false,
    handle(_request, response, state) {
      if (response.headersSent) return;
      const body = JSON.stringify({
        fixture: "gate-node",
        advisory: state.advisory,
        status: state.status,
      });
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
      });
      response.end(body);
    },
  });
}
