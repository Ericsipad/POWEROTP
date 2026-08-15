export function withPowerOtpFrameSource(policy: string, challengeOrigin: string): string {
  const origin = trustedPowerOtpOrigin(challengeOrigin);
  const directives = policy
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  const index = directives.findIndex((value) => value.toLowerCase().startsWith("frame-src "));
  if (index < 0) {
    directives.push(`frame-src 'self' ${origin}`);
  } else {
    const sources = directives[index]!.split(/\s+/);
    const name = sources.shift()!;
    const allowed = sources.filter((source) => source !== "'none'");
    if (!allowed.includes(origin)) allowed.push(origin);
    directives[index] = [name, ...allowed].join(" ");
  }
  return `${directives.join("; ")};`;
}

function trustedPowerOtpOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value.replace(/\/$/, "") ||
    url.username ||
    url.password ||
    (url.hostname !== "powerotp.com" && !url.hostname.endsWith(".powerotp.com"))
  ) {
    throw new TypeError("Challenge origin must be a POWEROTP-hosted HTTPS origin");
  }
  return url.origin;
}
