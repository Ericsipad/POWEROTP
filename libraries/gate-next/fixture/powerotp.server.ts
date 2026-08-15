import "server-only";

import { generateKeyPairSync } from "node:crypto";

import { createPowerOtpNext } from "@powerotp/gate-next";

const keys = generateKeyPairSync("ed25519");

export const powerOtp = createPowerOtpNext({
  siteId: "site_1234567890123456",
  siteCredential: "potp_bb_fixture_server_only_123456789",
  audience: "https://customer.example",
  verificationKeys: {
    active: {
      keyId: "key_1234567890123456",
      publicKey: keys.publicKey,
    },
  },
  protect: ({ path }) => path === "/" || path.startsWith("/api/private"),
});
