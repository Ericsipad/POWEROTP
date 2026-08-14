import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Window } from "happy-dom";
import { createPageLock } from "./page-lock.js";
import { createChallengeMessageHandler } from "./post-message.js";
import { resolveSafeReturn } from "./safe-return.js";

describe("page lock", () => {
  it("freezes interaction, focuses the challenge, and restores the page", async () => {
    const window = new Window({ url: "https://customer.example/account" });
    const document = window.document as unknown as Document;
    const button = document.createElement("button");
    button.textContent = "Customer action";
    document.body.append(button);
    document.body.style.overflow = "auto";
    button.focus();

    const lock = createPageLock({
      document,
      challengeUrl: "https://verify.powerotp.com/challenge/phase9",
      allowedChallengeOrigin: "https://verify.powerotp.com",
    });
    lock.freeze();

    const overlay = document.querySelector<HTMLElement>("[data-powerotp-botblocker-lock]");
    const frame = overlay?.querySelector<HTMLIFrameElement>("iframe");
    assert.ok(overlay);
    assert.ok(frame);
    assert.equal(lock.isFrozen(), true);
    assert.equal(document.body.style.overflow, "hidden");
    assert.equal(button.inert, true);
    assert.equal(button.getAttribute("aria-hidden"), "true");
    assert.equal(frame.referrerPolicy, "no-referrer");
    assert.equal(frame.allow, "none");
    assert.equal(document.activeElement, frame);
    assert.equal(lock.getMessageSource(), frame.contentWindow);

    const latePortal = document.createElement("div");
    document.body.append(latePortal);
    await Promise.resolve();
    assert.equal(latePortal.inert, true);
    assert.equal(latePortal.getAttribute("aria-hidden"), "true");

    lock.unfreeze();
    assert.equal(lock.isFrozen(), false);
    assert.equal(document.querySelector("[data-powerotp-botblocker-lock]"), null);
    assert.equal(document.body.style.overflow, "auto");
    assert.equal(button.inert, false);
    assert.equal(button.hasAttribute("aria-hidden"), false);
    assert.equal(latePortal.inert, false);
    assert.equal(latePortal.hasAttribute("aria-hidden"), false);
    assert.equal(document.activeElement, button);
  });

  it("requires a credential-free HTTPS challenge URL", () => {
    const window = new Window();
    for (const challengeUrl of [
      "http://verify.powerotp.com/challenge",
      "https://user:pass@verify.powerotp.com/challenge",
    ]) {
      assert.throws(
        () =>
          createPageLock({
            document: window.document as unknown as Document,
            challengeUrl,
            allowedChallengeOrigin: "https://verify.powerotp.com",
          }),
        /credential-free HTTPS/,
      );
    }
    assert.throws(
      () =>
        createPageLock({
          document: window.document as unknown as Document,
          challengeUrl: "https://attacker.example/challenge",
          allowedChallengeOrigin: "https://verify.powerotp.com",
        }),
      /approved HTTPS origin/,
    );
  });
});

describe("challenge postMessage guard", () => {
  it("turns a strict UX message into a poll request, never verification", () => {
    const source = {} as MessageEventSource;
    let polls = 0;
    const handler = createChallengeMessageHandler({
      expectedOrigin: "https://verify.powerotp.com/challenge",
      expectedSource: source,
      challengeId: "challenge_phase9_123",
      requestAuthoritativePoll: () => {
        polls += 1;
      },
    });
    const validData = {
      source: "powerotp-botblocker",
      type: "challenge-status-changed",
      challengeId: "challenge_phase9_123",
    };

    assert.equal(
      handler({
        origin: "https://attacker.example",
        source,
        data: validData,
      } as MessageEvent),
      false,
    );
    assert.equal(
      handler({
        origin: "https://verify.powerotp.com",
        source: {} as MessageEventSource,
        data: validData,
      } as MessageEvent),
      false,
    );
    assert.equal(
      handler({
        origin: "https://verify.powerotp.com",
        source,
        data: { ...validData, verified: true },
      } as MessageEvent),
      false,
    );
    assert.equal(
      handler({
        origin: "https://verify.powerotp.com",
        source,
        data: validData,
      } as MessageEvent),
      true,
    );
    assert.equal(polls, 1);
  });

  it("requires a credential-free HTTPS authority origin", () => {
    assert.throws(
      () =>
        createChallengeMessageHandler({
          expectedOrigin: "http://verify.powerotp.com",
          expectedSource: null,
          challengeId: "challenge_phase9_123",
          requestAuthoritativePoll() {},
        }),
      /credential-free HTTPS/,
    );
  });
});

describe("safe returns", () => {
  const options = {
    origin: "https://customer.example",
    isApprovedPath: (pathname: string) =>
      pathname === "/account" || pathname.startsWith("/account/"),
    fallbackPath: "/account",
  };

  it("preserves an approved same-origin path, query, and fragment", () => {
    assert.equal(
      resolveSafeReturn("/account/orders?page=2#recent", options),
      "/account/orders?page=2#recent",
    );
  });

  it("rejects open redirects, unapproved paths, and malformed destinations", () => {
    const rejected = [
      "https://customer.example/account",
      "https://attacker.example/",
      "//attacker.example/path",
      "/\\attacker.example",
      "/%2f%2fattacker.example",
      "/admin",
      null,
    ];
    for (const candidate of rejected) {
      assert.equal(resolveSafeReturn(candidate, options), "/account");
    }
  });

  it("requires the fallback itself to be approved", () => {
    assert.throws(
      () =>
        resolveSafeReturn("/account", {
          ...options,
          fallbackPath: "/admin",
        }),
      /fallback must be an approved/,
    );
  });
});
