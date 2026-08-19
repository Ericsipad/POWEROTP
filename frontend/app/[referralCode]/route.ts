import { apiFetch } from "@/lib/api-client";
import { NextResponse, type NextRequest } from "next/server";

const REFERRAL_COOKIE = "powerotp_referral";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

interface RouteParams {
  params: Promise<{ referralCode: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { referralCode } = await params;
  const lookup = await apiFetch(`/v1/referrals/${encodeURIComponent(referralCode)}`, {
    cache: "no-store",
  }).catch(() => undefined);
  const valid = lookup?.ok && Boolean((await lookup.json().catch(() => undefined))?.valid);
  const destination = new URL(valid ? "/" : "/?referral=invalid", request.url);
  const response = NextResponse.redirect(destination);
  if (valid && !request.cookies.get(REFERRAL_COOKIE)) {
    response.cookies.set(REFERRAL_COOKIE, referralCode, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: THIRTY_DAYS_SECONDS,
    });
  }
  return response;
}
