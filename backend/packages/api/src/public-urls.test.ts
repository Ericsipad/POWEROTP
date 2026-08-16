import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  demoVerificationStatusUrl,
  modalSessionUrl,
  projectVerificationUrl,
  verificationStatusUrl,
} from "./public-urls.js";

describe("public URL construction", () => {
  const apiBase = "https://api.powerotp.com";
  const appBase = "https://powerotp.com";

  it("keeps verification and project API URLs on the backend origin", () => {
    assert.equal(
      verificationStatusUrl(apiBase, "int_123"),
      "https://api.powerotp.com/v1/verifications/int_123",
    );
    assert.equal(
      demoVerificationStatusUrl(apiBase, "int_demo"),
      "https://api.powerotp.com/v1/demo/verifications/int_demo",
    );
    assert.equal(
      projectVerificationUrl(apiBase, "example-project"),
      "https://api.powerotp.com/v1/projects/example-project/verifications",
    );
  });

  it("keeps hosted modal URLs on the frontend origin", () => {
    assert.equal(
      modalSessionUrl(appBase, "mss_123"),
      "https://powerotp.com/widget/mss_123",
    );
  });
});
