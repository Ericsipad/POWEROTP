/**
 * Static architecture/data-boundary content for the public BotBlocker MCP
 * resources. This module documents current product behavior only; it adds
 * no new runtime behavior of its own.
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
        "Exactly two backend decisions exist. `checking`, `fail_open`, `offline`, `unavailable`, and " +
        "`observing` are lifecycle states, never a third decision.",
    },
    lifecycleToRecommendation: {
      checking: "restricted",
      fail_open: "full_access",
      offline: "full_access",
      unavailable: "full_access",
      allow: "full_access",
      otp: "otp_required",
      authoritativeOtpSuccess: "full_access",
    },
    sharedAuthority:
      "@powerotp/gate-node is the single server authority behind all three wrappers " +
      "(raw Node HTTP, Express, Next.js). Express and Next.js delegate to it rather than " +
      "reimplementing verification, session, or decision logic.",
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
      webhookEndpoint:
        "An immutable self-validating endpoint identifier returned at project creation. Its " +
        "server-verified HMAC binds version, endpoint, project, and site before any shared-state " +
        "lookup. It is configuration, not an authentication credential.",
      siteCredential:
        "Server-only site API credential (`potp_bb_*`), shown once at rotation " +
        "(POST /v1/projects/{projectId}/botblocker/rotate-site-credential), stored only hashed " +
        "thereafter. Used once per new visitor for first-contact session creation. Never sent " +
        "to a browser, logged, placed in a URL, or accepted as an MCP tool argument.",
      scopedVisitorToken:
        "A 30-minute opaque token minted after the first-contact session row exists. The adapter " +
        "holds the reusable bearer server-side; durable session storage keeps only token ID, " +
        "expiry, and one-way digest metadata. At minute 29 middleware sends the refresh request " +
        "and replaces the rotated bearer in its server-side gate session without changing the " +
        "session or user-intelligence binding. Every later per-visitor call forwards only this " +
        "token — the site credential is never resent.",
      webhookSigningSecret:
        "Independent 256-bit callback secret per project, shown once in the atomic project creation " +
        "response and stored encrypted at rest. It verifies POWEROTP's signed project callback " +
        "events, including challenge-status events. BotBlocker session-data-ready notifications are " +
        "currently unavailable. A callback notification is not visitor authority; the adapter pulls " +
        "current session data with that visitor's scoped token.",
      returningVisitorInstantAllowCookie:
        "`powerotp_site_return` is a signed, persistent, site-scoped credential bound to the exact " +
        "user-intelligence row. On a later visit the adapter verifies it locally and publishes " +
        "immediate access while starting the active visitor session. Continued reports may revoke " +
        "the credential or require OTP; expiry, deletion, invalid signature, active OTP, and " +
        "authoritative revocation take precedence. It is distinct from the gate-session cookie " +
        "and short-lived access clearance. Signature verification uses the site's verificationKeys.",
      browserReceives:
        "Neither the site credential nor the scoped visitor token. The browser HTTP stack may hold " +
        "HttpOnly, SameSite gate-session, site-return, and short-clearance cookies; browser " +
        "JavaScript cannot read them. Same-origin bridge routes require a non-simple " +
        "`X-PowerOTP-Bridge: 1` marker plus Fetch Metadata/Origin checks.",
    },
    fingerprintBoundary: {
      collected:
        "Broad, bounded, versioned browser/device fingerprint components are separate from behavior " +
        "reports. The complete first middleware request is retained as the session snapshot and " +
        "initial risk event, and the Mongo master retains raw components without inbound hashing; page " +
        "content, form values, raw keystrokes, clicked text, and pointer trails remain prohibited.",
      exactLookup:
        "During user-intelligence creation/update, POWEROTP writes the approved stable-source " +
        "fields and derives one versioned keyed verify lookup from those row values, storing it " +
        "on that same row for edge publication. Home matching uses the signed site-return " +
        "credential, Passport, or exact raw fingerprint comparison. IP alone never merges profiles, " +
        "and no browser/library visitor ID or fuzzy match is authoritative.",
      implementationStatus:
        "Expanded fingerprint component collection is present, but raw-first persistence, the " +
        "user-row verify lookup, user-intelligence return binding, and edge publication " +
        "are currently unavailable in the public integration.",
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
