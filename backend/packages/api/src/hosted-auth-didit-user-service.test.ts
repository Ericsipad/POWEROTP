import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HostedAuthDiditUserResult } from "@powerotp/contracts";

import {
  DiditManagementUserProvider,
  HostedAuthDiditUserService,
  createDiditManagementUserProvider,
  type HostedAuthDiditUserMappingRepository,
} from "./hosted-auth-didit-user-service.js";

const personId = `hpi_${"A".repeat(43)}`;
const diditInternalId = "2f1c2c6e-65cd-4a4c-8f4b-89d1b10d6e26";

class MemoryMappingRepository
  implements HostedAuthDiditUserMappingRepository
{
  potpDiditId?: string;
  diditInternalId?: string;
  reserveInputs: Array<{ proposedPotpDiditId: string }> = [];
  completeCalls = 0;

  async reserve(input: {
    hostedPersonIdentityId: string;
    proposedPotpDiditId: string;
    reservedAt: Date;
  }) {
    this.reserveInputs.push(input);
    if (this.diditInternalId) {
      return {
        status: "mapped",
        mapping: {
          potpDiditId: this.potpDiditId!,
          diditInternalId: this.diditInternalId,
        },
      } as const;
    }
    this.potpDiditId ??= input.proposedPotpDiditId;
    return { status: "reserved", potpDiditId: this.potpDiditId } as const;
  }

  async completeWithProvider(
    input: {
      hostedPersonIdentityId: string;
      potpDiditId: string;
    },
    createOrResolveProviderUser: () => Promise<{
      mapping: HostedAuthDiditUserResult;
      completedAt: Date;
    }>,
  ): Promise<HostedAuthDiditUserResult> {
    this.completeCalls += 1;
    const { mapping } = await createOrResolveProviderUser();
    this.diditInternalId = mapping.diditInternalId;
    return mapping;
  }
}

describe("hosted-auth Didit User service", () => {
  it("reserves one opaque person-root ID before creating and persisting the User", async () => {
    const repository = new MemoryMappingRepository();
    const providerInputs: Array<{ potpDiditId: string }> = [];
    const service = new HostedAuthDiditUserService(repository, {
      async createOrResolveUser(input) {
        providerInputs.push(input);
        return { potpDiditId: input.potpDiditId, diditInternalId };
      },
    });

    const first = await service.createOrResolve(personId);
    const second = await service.createOrResolve(personId);

    assert.match(first.potpDiditId, /^pdi_/);
    assert.equal(first.diditInternalId, diditInternalId);
    assert.deepEqual(second, first);
    assert.equal(providerInputs.length, 1);
    assert.equal(repository.completeCalls, 1);
    assert.equal(
      repository.reserveInputs[0]?.proposedPotpDiditId,
      providerInputs[0]?.potpDiditId,
    );
  });

  it("rejects a provider result that changes the reserved vendor data", async () => {
    const repository = new MemoryMappingRepository();
    const service = new HostedAuthDiditUserService(repository, {
      async createOrResolveUser() {
        return {
          potpDiditId: `pdi_${"E".repeat(43)}`,
          diditInternalId,
        };
      },
    });
    await assert.rejects(
      service.createOrResolve(personId),
      /does not match the reserved mapping/,
    );
    assert.equal(repository.completeCalls, 1);
    assert.equal(repository.diditInternalId, undefined);
  });
});

describe("Didit Management User provider", () => {
  it("creates a User with only opaque vendor_data and returns the strict mapping", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new DiditManagementUserProvider(
      "server-api-key",
      async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json(
          {
            vendor_data: `pdi_${"A".repeat(43)}`,
            didit_internal_id: diditInternalId,
            full_name: null,
          },
          { status: 201 },
        );
      },
    );

    const result = await provider.createOrResolveUser({
      hostedPersonIdentityId: personId,
      potpDiditId: `pdi_${"A".repeat(43)}`,
    });

    assert.deepEqual(result, {
      potpDiditId: `pdi_${"A".repeat(43)}`,
      diditInternalId,
    });
    assert.equal(calls[0]?.url, "https://verification.didit.me/v3/users/create/");
    assert.equal(calls[0]?.init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      vendor_data: `pdi_${"A".repeat(43)}`,
    });
    assert.equal(
      (calls[0]?.init?.headers as Record<string, string>)["x-api-key"],
      "server-api-key",
    );
  });

  it("resolves the same User after Didit's non-idempotent duplicate response", async () => {
    const urls: string[] = [];
    const provider = new DiditManagementUserProvider(
      "server-api-key",
      async (url) => {
        urls.push(String(url));
        return urls.length === 1
          ? Response.json({ detail: "vendor_data already exists" }, { status: 400 })
          : Response.json({
              vendor_data: `pdi_${"A".repeat(43)}`,
              didit_internal_id: diditInternalId,
            });
      },
    );

    const result = await provider.createOrResolveUser({
      hostedPersonIdentityId: personId,
      potpDiditId: `pdi_${"A".repeat(43)}`,
    });

    assert.equal(result.diditInternalId, diditInternalId);
    assert.equal(
      urls[1],
      `https://verification.didit.me/v3/users/pdi_${"A".repeat(43)}/`,
    );
  });

  it("fails closed on mismatched or unavailable provider responses", async () => {
    const mismatched = new DiditManagementUserProvider(
      "server-api-key",
      async () =>
        Response.json(
          {
            vendor_data: `pdi_${"E".repeat(43)}`,
            didit_internal_id: diditInternalId,
          },
          { status: 201 },
        ),
    );
    await assert.rejects(
      mismatched.createOrResolveUser({
        hostedPersonIdentityId: personId,
        potpDiditId: `pdi_${"A".repeat(43)}`,
      }),
      /different vendor data/,
    );

    const unavailable = new DiditManagementUserProvider(
      "server-api-key",
      async () => new Response(null, { status: 503 }),
    );
    await assert.rejects(
      unavailable.createOrResolveUser({
        hostedPersonIdentityId: personId,
        potpDiditId: `pdi_${"A".repeat(43)}`,
      }),
      /HTTP 503/,
    );
  });

  it("stays disabled when the Didit API key is absent", () => {
    assert.equal(createDiditManagementUserProvider({}), undefined);
  });
});
