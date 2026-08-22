export const HOSTED_AUTH_DEPLOYMENTS = {
  production: {
    powerotp_pii: {
      hostname: "authx.powerotp.com",
      origin: "https://authx.powerotp.com",
      rpId: "authx.powerotp.com",
    },
    didit_pii: {
      hostname: "authz.powerotp.com",
      origin: "https://authz.powerotp.com",
      rpId: "authz.powerotp.com",
    },
  },
  staging: {
    powerotp_pii: {
      hostname: "authx.staging.powerotp.com",
      origin: "https://authx.staging.powerotp.com",
      rpId: "authx.staging.powerotp.com",
    },
    didit_pii: {
      hostname: "authz.staging.powerotp.com",
      origin: "https://authz.staging.powerotp.com",
      rpId: "authz.staging.powerotp.com",
    },
  },
  development: {
    powerotp_pii: {
      hostname: "authx.localhost",
      origin: "http://authx.localhost",
      rpId: "authx.localhost",
    },
    didit_pii: {
      hostname: "authz.localhost",
      origin: "http://authz.localhost",
      rpId: "authz.localhost",
    },
  },
  test: {
    powerotp_pii: {
      hostname: "authx.test",
      origin: "https://authx.test",
      rpId: "authx.test",
    },
    didit_pii: {
      hostname: "authz.test",
      origin: "https://authz.test",
      rpId: "authz.test",
    },
  },
} as const;

export const HOSTED_AUTH_REALM_REQUEST_HEADER =
  "x-powerotp-hosted-auth-realm";

export type HostedAuthDeploymentEnvironment =
  keyof typeof HOSTED_AUTH_DEPLOYMENTS;
export type HostedAuthIdentityDataMode = "powerotp_pii" | "didit_pii";

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

export function resolveHostedAuthRealmFromValidatedHostname(
  hostname: string,
): HostedAuthRealm | null {
  for (const environment of Object.keys(
    HOSTED_AUTH_DEPLOYMENTS,
  ) as HostedAuthDeploymentEnvironment[]) {
    const realm = resolveHostedAuthRealm(hostname, environment);
    if (realm) return realm;
  }
  return null;
}

export function isHostedAuthHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  return Object.values(HOSTED_AUTH_DEPLOYMENTS).some((deployment) =>
    Object.values(deployment).some(
      (realm) => realm.hostname === normalizedHostname,
    ),
  );
}
