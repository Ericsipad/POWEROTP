export function sessionCookieOptions(expires: Date) {
  return {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    expires,
  };
}

export function csrfCookieOptions(expires: Date) {
  return {
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "strict" as const,
    expires,
  };
}
