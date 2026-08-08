import type { Node, NodeConfig } from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { ProductionConfig } from "./config.js";
import { allOutboundTrunks } from "./outbound-trunks.js";
import type { NodeDocument } from "./persistence.js";
import { createId, safeEqual } from "./security.js";

export class NodeError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

/**
 * Telephony node identity is one shared secret (`NODE_SECRET`), entered
 * once in App Platform and compared directly (constant-time), the same
 * convention this app already uses for `ADMIN_PASSWORD` — never a
 * per-node value generated through an admin flow and copied onto a
 * droplet by hand. Every allowlisted droplet receives identical
 * configuration, so there is nothing to individually enroll or revoke;
 * rotating access is editing `NODE_SECRET` in App Platform and
 * redeploying every droplet with the new value.
 */
export class NodeService {
  readonly #nodes;

  constructor(
    db: Db,
    private readonly config: ProductionConfig,
  ) {
    this.#nodes = db.collection<NodeDocument>("nodes");
  }

  async list(): Promise<Node[]> {
    const nodes = await this.#nodes.find().sort({ lastSeenAt: -1 }).toArray();
    return nodes.map((node) => this.#toResponse(node));
  }

  /**
   * Authenticates a droplet-originated request against the shared
   * secret. Recording the connection here doubles as a liveness heartbeat
   * and is what makes a node show up in `/admin` automatically the first
   * time it polls — there is no separate enrollment step.
   */
  async authenticate(
    authorizationHeader: string | undefined,
    clientIp: string | undefined,
  ): Promise<NodeDocument> {
    const match = /^Bearer\s+(\S+)$/.exec(authorizationHeader ?? "");
    if (!match || !this.config.NODE_SECRET || !safeEqual(match[1]!, this.config.NODE_SECRET)) {
      throw new NodeError("node_authentication_required", 401);
    }

    const ip = clientIp ?? "unknown";
    const now = new Date();
    const node = await this.#nodes.findOneAndUpdate(
      { ip },
      { $set: { lastSeenAt: now }, $setOnInsert: { _id: createId("node"), firstSeenAt: now } },
      { upsert: true, returnDocument: "after" },
    );
    if (!node) throw new NodeError("node_authentication_required", 401);
    return node;
  }

  configFor(): NodeConfig {
    return { trunks: allOutboundTrunks(this.config) };
  }

  #toResponse(node: NodeDocument): Node {
    return {
      id: node._id,
      ip: node.ip,
      firstSeenAt: node.firstSeenAt.toISOString(),
      lastSeenAt: node.lastSeenAt.toISOString(),
    };
  }
}
