import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedAuthProjectSettingsSchema,
  HostedAuthReturnUrlsSchema,
  UpdateHostedAuthProjectSettingsSchema,
} from "./hosted-auth-project-configuration.js";

const returnUrls = {
  signupReturnUrl: "https://client.example/auth/signup",
  signinReturnUrl: "https://client.example/auth/signin",
  failureReturnUrl: "https://client.example/auth/failure",
  recoveryReturnUrl: "https://client.example/auth/recovery",
  restartUrl: "https://client.example/login",
};

const settings = {
  signupEnabled: true,
  signinEnabled: true,
  methodPolicy: {
    signupContactMethods: ["email"],
    signinMethods: ["passkey", "email"],
  },
  assurancePolicy: {
    minimumAge: 18,
    identityKycRequired: true,
    livenessRequired: false,
  },
};

describe("hosted-auth project configuration contracts", () => {
  it("requires all five exact named return URL fields", () => {
    assert.equal(HostedAuthReturnUrlsSchema.safeParse(returnUrls).success, true);
    const { restartUrl: _, ...incomplete } = returnUrls;
    assert.equal(HostedAuthReturnUrlsSchema.safeParse(incomplete).success, false);
    assert.equal(
      HostedAuthReturnUrlsSchema.safeParse({ ...returnUrls, arbitrary: "https://evil.test" })
        .success,
      false,
    );
  });

  it("accepts complete settings and rejects ambiguous method policy", () => {
    assert.equal(HostedAuthProjectSettingsSchema.safeParse(settings).success, true);
    assert.equal(
      HostedAuthProjectSettingsSchema.safeParse({
        ...settings,
        methodPolicy: {
          signupContactMethods: ["email", "email"],
          signinMethods: ["email"],
        },
      }).success,
      false,
    );
  });

  it("permits isolated partial updates but rejects empty and unknown updates", () => {
    assert.equal(
      UpdateHostedAuthProjectSettingsSchema.safeParse({ signinEnabled: false }).success,
      true,
    );
    assert.equal(UpdateHostedAuthProjectSettingsSchema.safeParse({}).success, false);
    assert.equal(
      UpdateHostedAuthProjectSettingsSchema.safeParse({ botBlockerEnabled: true }).success,
      false,
    );
  });
});
