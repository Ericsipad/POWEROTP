import {
  HOSTED_AUTH_DEPLOYMENTS,
  type HostedAuthDeploymentEnvironment,
  type HostedAuthIdentityDataMode,
} from "@powerotp/contracts";

export { HOSTED_AUTH_DEPLOYMENTS };
export type { HostedAuthDeploymentEnvironment };

export type HostedAuthRealm = Readonly<{
  environment: HostedAuthDeploymentEnvironment;
  identityDataMode: HostedAuthIdentityDataMode;
  hostname: string;
  origin: string;
  rpId: string;
}>;

export function hostedAuthDeploymentEnvironment(
  environment = process.env.HOSTED_AUTH_DEPLOYMENT_ENVIRONMENT,
  nodeEnvironment = process.env.NODE_ENV,
): HostedAuthDeploymentEnvironment {
  if (environment) {
    if (!(environment in HOSTED_AUTH_DEPLOYMENTS)) {
      throw new Error("Invalid hosted-auth deployment environment");
    }
    return environment as HostedAuthDeploymentEnvironment;
  }
  if (nodeEnvironment === "production") return "production";
  if (nodeEnvironment === "test") return "test";
  return "development";
}

export function resolveHostedAuthRealm(
  hostname: string,
  environment: HostedAuthDeploymentEnvironment,
): HostedAuthRealm | null {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  const deployment = HOSTED_AUTH_DEPLOYMENTS[environment];
  for (const identityDataMode of [
    "powerotp_pii",
    "didit_pii",
  ] as const) {
    const realm = deployment[identityDataMode];
    if (normalizedHostname === realm.hostname) {
      return { environment, identityDataMode, ...realm };
    }
  }
  return null;
}

export function resolveHostedAuthRealmFromRequestAuthorities(
  authorities: readonly (string | null)[],
): HostedAuthRealm | null {
  const realms = authorities.flatMap((authority) => {
    if (!authority || authority.includes(",")) return [];
    let hostname: string;
    try {
      hostname = new URL(`https://${authority}`).hostname;
    } catch {
      return [];
    }
    return (Object.keys(
      HOSTED_AUTH_DEPLOYMENTS,
    ) as HostedAuthDeploymentEnvironment[]).flatMap((environment) => {
      const realm = resolveHostedAuthRealm(hostname, environment);
      return realm ? [realm] : [];
    });
  });
  const unique = new Map(
    realms.map((realm) => [
      `${realm.environment}:${realm.identityDataMode}`,
      realm,
    ]),
  );
  return unique.size === 1 ? [...unique.values()][0]! : null;
}

export function hostedAuthHealthPayload(realm: HostedAuthRealm) {
  return {
    service: "powerotp-hosted-auth",
    status: "ok",
    environment: realm.environment,
    identityDataMode: realm.identityDataMode,
    realm: realm.hostname,
    rpId: realm.rpId,
  } as const;
}

export function isHostedAuthHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  return Object.values(HOSTED_AUTH_DEPLOYMENTS).some((deployment) =>
    Object.values(deployment).some(
      (realm) => realm.hostname === normalizedHostname,
    ),
  );
}
