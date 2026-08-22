import { randomBytes } from "node:crypto";

import {
  DiditInternalIdSchema,
  HostedAuthDiditUserRequestSchema,
  HostedAuthDiditUserResultSchema,
  HostedPersonIdentityIdSchema,
  PotpDiditIdSchema,
  type HostedAuthDiditUserRequest,
  type HostedAuthDiditUserResult,
  type HostedAuthDiditProvider,
} from "@powerotp/contracts";
import { z } from "zod";

import type { ProductionConfig } from "./config.js";

const DIDIT_API_ORIGIN = "https://verification.didit.me";
const DIDIT_REQUEST_TIMEOUT_MS = 10_000;
const DiditUserResponseSchema = z
  .object({
    vendor_data: PotpDiditIdSchema,
    didit_internal_id: DiditInternalIdSchema,
  })
  .passthrough();

type DiditUserProvider = Pick<HostedAuthDiditProvider, "createOrResolveUser">;
type Fetch = typeof fetch;

export interface HostedAuthDiditUserMappingRepository {
  reserve(input: {
    hostedPersonIdentityId: string;
    proposedPotpDiditId: string;
    reservedAt: Date;
  }): Promise<
    | Readonly<{ status: "mapped"; mapping: HostedAuthDiditUserResult }>
    | Readonly<{ status: "reserved"; potpDiditId: string }>
  >;
  completeWithProvider(
    input: {
      hostedPersonIdentityId: string;
      potpDiditId: string;
    },
    createOrResolveProviderUser: () => Promise<
      Readonly<{ mapping: HostedAuthDiditUserResult; completedAt: Date }>
    >,
  ): Promise<HostedAuthDiditUserResult>;
}

/**
 * Owns the durable person-root mapping. The POWEROTP identifier is reserved
 * before the provider side effect so retries and crash recovery can never
 * create a second Didit User for the same person.
 */
export class HostedAuthDiditUserService {
  constructor(
    private readonly repository: HostedAuthDiditUserMappingRepository,
    private readonly provider: DiditUserProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createOrResolve(
    unparsedHostedPersonIdentityId: string,
  ): Promise<HostedAuthDiditUserResult> {
    const hostedPersonIdentityId = HostedPersonIdentityIdSchema.parse(
      unparsedHostedPersonIdentityId,
    );
    const proposedPotpDiditId = PotpDiditIdSchema.parse(
      `pdi_${randomBytes(32).toString("base64url")}`,
    );
    const reservation = await this.repository.reserve({
      hostedPersonIdentityId,
      proposedPotpDiditId,
      reservedAt: this.now(),
    });
    if (reservation.status === "mapped") return reservation.mapping;

    return this.repository.completeWithProvider(
      {
        hostedPersonIdentityId,
        potpDiditId: PotpDiditIdSchema.parse(reservation.potpDiditId),
      },
      async () => {
        const mapping = HostedAuthDiditUserResultSchema.parse(
          await this.provider.createOrResolveUser({
            hostedPersonIdentityId,
            potpDiditId: PotpDiditIdSchema.parse(reservation.potpDiditId),
          }),
        );
        if (mapping.potpDiditId !== reservation.potpDiditId) {
          throw new Error("Didit User result does not match the reserved mapping");
        }
        return { mapping, completedAt: this.now() };
      },
    );
  }
}

/**
 * Minimal Didit Management API adapter for permanent User creation only.
 * Contact verification, sessions, polling, and decisions remain separate.
 */
export class DiditManagementUserProvider implements DiditUserProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    if (apiKey.length === 0) throw new Error("Didit API key is required");
  }

  async createOrResolveUser(
    unparsedRequest: HostedAuthDiditUserRequest,
  ): Promise<HostedAuthDiditUserResult> {
    const request = HostedAuthDiditUserRequestSchema.parse(unparsedRequest);
    const createResponse = await this.request("/v3/users/create/", {
      method: "POST",
      body: JSON.stringify({ vendor_data: request.potpDiditId }),
    });
    if (createResponse.status === 201) {
      return this.parseUser(createResponse, request.potpDiditId);
    }
    if (createResponse.status !== 400) {
      throw new Error(`Didit User creation failed with HTTP ${createResponse.status}`);
    }

    const existingResponse = await this.request(
      `/v3/users/${encodeURIComponent(request.potpDiditId)}/`,
      { method: "GET" },
    );
    if (existingResponse.status !== 200) {
      throw new Error(
        `Didit User resolution failed with HTTP ${existingResponse.status}`,
      );
    }
    return this.parseUser(existingResponse, request.potpDiditId);
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(`${DIDIT_API_ORIGIN}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(DIDIT_REQUEST_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
    });
  }

  private async parseUser(
    response: Response,
    expectedPotpDiditId: string,
  ): Promise<HostedAuthDiditUserResult> {
    const user = DiditUserResponseSchema.parse(await response.json());
    if (user.vendor_data !== expectedPotpDiditId) {
      throw new Error("Didit returned a User for different vendor data");
    }
    return HostedAuthDiditUserResultSchema.parse({
      potpDiditId: user.vendor_data,
      diditInternalId: user.didit_internal_id,
    });
  }
}

export function createDiditManagementUserProvider(
  config: Pick<ProductionConfig, "DIDIT_API_KEY">,
  fetchImpl: Fetch = fetch,
): DiditManagementUserProvider | undefined {
  return config.DIDIT_API_KEY
    ? new DiditManagementUserProvider(config.DIDIT_API_KEY, fetchImpl)
    : undefined;
}
