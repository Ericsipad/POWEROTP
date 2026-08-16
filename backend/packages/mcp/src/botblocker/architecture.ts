/**
 * Static architecture/data-boundary content for the public BotBlocker MCP
 * resources. Every fact here must already be true of shipped Phase 13B–13D
 * code (see `docs/POWEROTP_BOTBLOCKER_AS_BUILT.md`); this module adds no new
 * runtime behavior of its own.
 */

export function getBotBlockerArchitectureOverview() {
  return {
    product:
      "BotBlocker is an additive, state-publishing integration. It never enforces, redirects, " +
      "rewrites, or renders anything in the customer's application; customer code alone decides " +
      "whether and how to use the advisory state it publishes.",
    backendDecisions: {
      only: ["allow", "otp"] as const,
      note:
        "Exactly two backend decisions exist. `checking`, `fail_open`, `unavailable`, and " +
        "`observing` are lifecycle states, never a third decision.",
    },
    lifecycleToRecommendation: {
      checking: "restricted",
      fail_open: "full_access",
      unavailable: "full_access",
      allow: "full_access",
      otp: "otp_required",
      authoritativeOtpSuccess: "full_access",
    },
    sharedAuthority:
      "@powerotp/gate-node is the single server authority behind all three wrappers " +
      "(raw Node HTTP, Express, Next.js). Express and Next.js delegate to it rather than " +
      "reimplementing verification, session, or decision logic.",
    runtimeOrigins: {
      primary:
        "Planned, not yet deployed: https://verify.powerotp.com is the Cloudflare Workers " +
        "rapid-check origin adapters will contact first. Its short-lived edge intelligence " +
        "covers at least the most recent 30 days of denylisted IP and fingerprint signals.",
      authoritativeFallback:
        "https://api.powerotp.com remains the authoritative backend and full-history master " +
        "store. It is the fallback rapid-check origin when the Worker cannot be reached and " +
        "owns control-plane, policy, and durable history APIs.",
      deploymentBoundary:
        "BOTBLOCKER_RUNTIME_ORIGIN is backend deployment configuration, not a customer " +
        "application secret. Leave it unset until verify.powerotp.com is actually routed.",
    },
    otpOpener:
      "gate.openOtp() takes no arguments — no OTP type, method, policy, or content. POWEROTP " +
      "resolves the authenticated site/session decision server-side and returns only short-lived " +
      "metadata for a server-selected hosted iframe. The browser request body is always empty.",
    timeout:
      "The customer-configured decision timeout (50–2,000 ms, 200 ms recommended) publishes " +
      "fail-open `full_access` state on expiry or network failure. It never fabricates a signed " +
      "`allow` decision, and the underlying pending decision keeps running; a late verified " +
      "`allow` or `otp` still replaces the fail-open state when it arrives.",
    activeOtpPrecedence:
      "An active OTP challenge or an `otp_required` recommendation can never be silently " +
      "replaced by a later fail-open timeout or a stale/local `allow` clearance.",
    exclusions: [
      "/_powerotp and /_powerotp/* (owned same-origin bridge)",
      "/.well-known/powerotp-agent (discovery)",
      "/health, /health/*, /healthz, /ready, /readyz, /live, /livez",
      "/.well-known/health and /.well-known/health/*",
      "/_next/*, /assets/*, /static/*",
      "/favicon.ico, /robots.txt, /sitemap.xml",
      "HTTP OPTIONS requests",
      "WebSocket upgrade requests",
    ],
    exclusionsNote:
      "These are fixed technical exclusions, not a customer-selectable route predicate. Every " +
      "other customer application request receives advisory state.",
  } as const;
}

export function getBotBlockerDataBoundary() {
  return {
    credentialBoundary: {
      intendedDesign:
        "Exactly two project secrets, both generated once and independently rotatable: a site/" +
        "project API key (site credential) and a webhook signing secret. Neither is invented by " +
        "MCP — the site credential is already issued by the shipped " +
        "POST /v1/projects/{projectId}/botblocker/rotate-site-credential endpoint; the webhook " +
        "signing secret is specified in POWEROTP_BOTBLOCKER_PLAN.md but has no shipped issuance " +
        "flow or receiver yet.",
      siteCredential:
        "Server-only project API key (`potp_bb_*`), shown once at rotation, stored only hashed " +
        "thereafter. Used once per new visitor for first-contact session creation. Never sent " +
        "to a browser, logged, placed in a URL, or accepted as an MCP tool argument.",
      scopedVisitorToken:
        "An opaque token minted during site-credential-authenticated first contact. Stored only " +
        "in the server-side gate session. Every later per-visitor call (assessment, challenge " +
        "launch, polling) forwards only this token — the site credential is never resent.",
      webhookSigningSecret:
        "Planned (POWEROTP_BOTBLOCKER_PLAN.md, not yet shipped): an independent 256-bit secret " +
        "per project verifying the signed body of a fixed /_powerotp/webhooks/challenge-status " +
        "callback. No adapter implements that receiver yet, so no shipped code reads this today.",
      returningVisitorInstantAllowCookie:
        "A visitor who already received an `allow` gets a signed, long-lived cookie; on a later " +
        "visit the adapter verifies that cookie's signature entirely on its own server and " +
        "grants `allow` instantly, without waiting on a fresh decision or even reaching " +
        "PowerOTP (this also keeps working through a PowerOTP outage). An active OTP challenge " +
        "or a revoked/replaced clearance always takes precedence over this cookie. Checking the " +
        "signature needs a public verificationKeys value, which the shipped adapters take as a " +
        "direct constructor field today; Phase 14A (POWEROTP_BOTBLOCKER_DEVELOPMENT_PHASES.md) " +
        "resolves it automatically from the signed policy release at " +
        "GET /v1/botblocker/policy/{siteId} using only the public siteId.",
      browserReceives:
        "Neither the site credential nor the scoped visitor token. The browser holds only an " +
        "HttpOnly, SameSite gate-session cookie and calls same-origin bridge routes that require " +
        "a non-simple `X-PowerOTP-Bridge: 1` marker plus Fetch Metadata/Origin checks.",
    },
    prohibitedInOutput: [
      "customer credentials or account state",
      "project IDs",
      "risk data or scoring internals",
      "deployment authorization",
      "scoped visitor tokens",
      "signed clearance/decision material",
      "raw fingerprint, keystroke, form-value, or pointer-trail data",
    ],
    mcpBoundary: {
      access: "public, anonymous, read-only, credential-free",
      prohibitedActions: [
        "account management",
        "deployment",
        "repository mutation",
        "dashboard mutation",
        "hosting configuration",
      ],
      note:
        "MCP never reads or returns customer data and never accepts a credential as a tool " +
        "argument. It generates documentation and versioned integration templates only; the " +
        "customer's own AI/developer performs any repository change or dashboard/hosting click.",
    },
    customerOwnership: [
      "SSR and rendering",
      "APIs and Server Actions",
      "request/response bodies and streams",
      "routing",
      "error handling",
      "whether and how to act on any advisory state",
    ],
    knownLimitation:
      "An application-layer adapter (raw Node HTTP, Express, Next.js) can only publish state " +
      "for requests that reach that process. A directly reachable origin that bypasses the " +
      "adapter, a CDN, or a load balancer is invisible to BotBlocker; customers must restrict " +
      "direct-origin access independently.",
  } as const;
}
