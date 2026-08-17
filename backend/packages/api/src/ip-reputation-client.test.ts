import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createIpReputationVendorClient } from "./ip-reputation-client.js";

const fullConfig = {
  BOTBLOCKER_IP_REPUTATION_VENDOR_NAME: "acme-ip-intel",
  BOTBLOCKER_IP_REPUTATION_VENDOR_URL: "https://vendor.example.com",
  BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY: "test-key",
};

describe("createIpReputationVendorClient", () => {
  it("returns undefined when any of the three variables is unset", () => {
    assert.equal(
      createIpReputationVendorClient({
        BOTBLOCKER_IP_REPUTATION_VENDOR_NAME: undefined,
        BOTBLOCKER_IP_REPUTATION_VENDOR_URL: undefined,
        BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY: undefined,
      }),
      undefined,
    );
    assert.equal(
      createIpReputationVendorClient({
        ...fullConfig,
        BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY: undefined,
      }),
      undefined,
    );
  });

  it("exposes the configured vendor name once all three variables are set", () => {
    const client = createIpReputationVendorClient(fullConfig);
    assert.equal(client?.vendorName, "acme-ip-intel");
  });

  it("rejects from lookup as an intentional 'unavailable' placeholder until a real vendor is chosen", async () => {
    const client = createIpReputationVendorClient(fullConfig);
    await assert.rejects(client!.lookup("203.0.113.5"));
  });
});
