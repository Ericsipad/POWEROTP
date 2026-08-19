import { parseBody } from "@powerotp/api/errors.js";
import { SignupSchema, type SignupResponse } from "@powerotp/contracts";
import { NextResponse } from "next/server";

import { apiRoute, clientIp, requireAllowedOrigin } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServerContext } from "@/lib/server-context";

/**
 * The "rapid signup" flow (`frontend/app/signup-modal.tsx`): one submission
 * creates the customer account *and* its first project/API key together,
 * shown once in the same modal — see `docs/AS_BUILT.md`'s "Customer signup
 * flow" section. The verification email is still required before the
 * account can create any real verification (`AuthService#requireVerifiedEmail`),
 * but the API key itself is issued immediately so there is nothing to come
 * back for later.
 */
export const POST = apiRoute(async (request) => {
  const { auth, config, dataStores, projects, referrals } = await getServerContext();
  requireAllowedOrigin(request, config.PUBLIC_APP_URL);
  await enforceRateLimit(dataStores.rateLimitStore, `rl:signup:${clientIp(request) ?? "unknown"}`, 5, 60);

  const input = parseBody(SignupSchema, await request.json());
  const { userId, alreadyVerified } = await auth.register({
    email: input.email,
    password: input.password,
  });

  if (alreadyVerified) {
    // Anti-enumeration: never reveal an existing project/API key here.
    const body: SignupResponse = { status: "already_registered" };
    return NextResponse.json(body, { status: 202 });
  }

  if (input.referralCode) {
    await referrals.attributeAccount(userId, input.referralCode);
  }

  const existingProjects = await projects.list(userId);
  if (existingProjects.length > 0) {
    // A retry of an unverified signup — the API key was already shown once
    // before and is never re-derivable, so there is nothing new to return.
    const body: SignupResponse = {
      status: "verification_email_queued",
      project: existingProjects[0],
    };
    return NextResponse.json(body, { status: 200 });
  }

  const created = await projects.create(userId, {
    name: "My Project",
    enabledMethods: ["call_reachability", "voice_code", "voice_challenge", "sms_code"],
    allowedOrigins: [],
  });

  const body: SignupResponse = {
    status: "verification_email_queued",
    project: created.project,
    apiKey: created.apiKey,
    botBlocker: created.botBlocker,
  };
  const response = NextResponse.json(body, { status: 201 });
  response.headers.set("cache-control", "no-store");
  return response;
});
