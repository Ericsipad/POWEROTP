const REFERRAL_COOKIE = "powerotp_referral";
const REFERRAL_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

export function referralCodeFromCookie(cookieHeader: string): string | undefined {
  const encoded = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REFERRAL_COOKIE}=`))
    ?.slice(REFERRAL_COOKIE.length + 1);
  if (!encoded) return undefined;
  try {
    const code = decodeURIComponent(encoded).trim().toLowerCase();
    return REFERRAL_CODE_PATTERN.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}
