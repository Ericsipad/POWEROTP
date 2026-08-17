import type { ProductionConfig } from "./config.js";

export interface IpReputationLookupResult {
  score: number;
  rawResponse: unknown;
}

export interface IpReputationVendorClient {
  vendorName: string;
  lookup(ip: string): Promise<IpReputationLookupResult>;
}

type IpReputationVendorConfig = Pick<
  ProductionConfig,
  | "BOTBLOCKER_IP_REPUTATION_VENDOR_NAME"
  | "BOTBLOCKER_IP_REPUTATION_VENDOR_URL"
  | "BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY"
>;

/**
 * The external vendor call behind `botblockerIpApiLookupsV4`/`V6`'s
 * wait-for-full-result branch (Phase 16 network-intelligence design,
 * plan correction 6: awaited, not fire-and-forget). Returns `undefined`
 * until all three `BOTBLOCKER_IP_REPUTATION_VENDOR_*` variables are
 * configured — the same "code-complete but fails closed without live
 * credentials" convention as `createSpacesClient`
 * (`backend/packages/api/src/spaces-client.ts`).
 *
 * Even once configured, `lookup` itself stays an intentional
 * "unavailable" placeholder: no specific vendor has been chosen yet (the
 * user mentioned one informally, possibly a mishearing — see the Phase
 * 16 plan's section 5), and this project's own rule is to never fabricate
 * a real HTTP integration against an unknown vendor's actual
 * request/response shape. Implementing the real call later is a
 * single-function change inside this module once a vendor is chosen;
 * nothing else in the caching path
 * (`backend/packages/api/src/botblocker-ip-reputation-service.ts`) needs
 * to change.
 */
export function createIpReputationVendorClient(
  config: IpReputationVendorConfig,
): IpReputationVendorClient | undefined {
  const {
    BOTBLOCKER_IP_REPUTATION_VENDOR_NAME,
    BOTBLOCKER_IP_REPUTATION_VENDOR_URL,
    BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY,
  } = config;
  if (
    !BOTBLOCKER_IP_REPUTATION_VENDOR_NAME ||
    !BOTBLOCKER_IP_REPUTATION_VENDOR_URL ||
    !BOTBLOCKER_IP_REPUTATION_VENDOR_API_KEY
  ) {
    return undefined;
  }

  return {
    vendorName: BOTBLOCKER_IP_REPUTATION_VENDOR_NAME,
    lookup(): Promise<IpReputationLookupResult> {
      return Promise.reject(
        new Error("IP reputation vendor HTTP integration is not implemented yet"),
      );
    },
  };
}
