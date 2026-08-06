import type { CreateNode, Node, NodeConfig } from "@powerotp/contracts";
import type { Db } from "mongodb";

import type { ProductionConfig } from "./config.js";
import { outboundTrunkFor } from "./outbound-trunks.js";
import type { AuditDocument, NodeDocument } from "./persistence.js";
import { createId, createSecret, hashToken } from "./security.js";

export class NodeError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

/**
 * Telephony node identity and configuration distribution. A node
 * authenticates with a hashed bearer secret (see `nodes.ts` in
 * `@powerotp/contracts` for why this replaces the originally planned
 * mutual TLS) and, once authenticated, pulls only the outbound trunk
 * credentials App Platform currently has configured — never any other
 * app secret. Reuses `API_KEY_HASH_SECRET` for hashing node secrets: it is
 * an HMAC key, not tied to one token format, and adding a second
 * dedicated secret for a structurally identical credential type would be
 * duplication without a security benefit.
 */
export class NodeService {
  readonly #nodes;
  readonly #audits;

  constructor(
    db: Db,
    private readonly config: ProductionConfig,
  ) {
    this.#nodes = db.collection<NodeDocument>("nodes");
    this.#audits = db.collection<AuditDocument>("auditEvents");
  }

  async enroll(actorId: string, input: CreateNode) {
    const raw = `potp_node_${createSecret()}`;
    const now = new Date();
    const document: NodeDocument = {
      _id: createId("node"),
      name: input.name,
      region: input.region,
      secretHash: hashToken(raw, this.config.API_KEY_HASH_SECRET),
      secretPrefix: raw.slice(0, 14),
      secretLastFour: raw.slice(-4),
      status: "active",
      enrolledAt: now,
      createdBy: actorId,
    };
    await this.#nodes.insertOne(document);
    await this.#audit(actorId, "node.enrolled", document._id);
    return { node: this.#toResponse(document), secret: raw };
  }

  async list(): Promise<Node[]> {
    const nodes = await this.#nodes.find().sort({ enrolledAt: -1 }).toArray();
    return nodes.map((node) => this.#toResponse(node));
  }

  async revoke(actorId: string, nodeId: string): Promise<Node> {
    const node = await this.#nodes.findOneAndUpdate(
      { _id: nodeId, status: "active" },
      { $set: { status: "revoked", revokedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!node) throw new NodeError("node_not_found", 404);
    await this.#audit(actorId, "node.revoked", nodeId);
    return this.#toResponse(node);
  }

  /**
   * Authenticates a droplet-originated request. Only ever accepted from
   * the `Authorization: Bearer` header, never a URL or query parameter,
   * matching the project API key convention. Records `lastSeenAt` as a
   * side effect so this call doubles as a liveness heartbeat.
   */
  async authenticate(authorizationHeader: string | undefined): Promise<NodeDocument> {
    const match = /^Bearer\s+(\S+)$/.exec(authorizationHeader ?? "");
    if (!match) throw new NodeError("node_authentication_required", 401);

    const secretHash = hashToken(match[1]!, this.config.API_KEY_HASH_SECRET);
    const node = await this.#nodes.findOne({ secretHash, status: "active" });
    if (!node) throw new NodeError("node_authentication_required", 401);

    await this.#nodes.updateOne({ _id: node._id }, { $set: { lastSeenAt: new Date() } });
    return node;
  }

  configFor(node: NodeDocument): NodeConfig {
    return {
      nodeId: node._id,
      trunks: {
        call_reachability: outboundTrunkFor(this.config, "call_reachability"),
        voice_code: outboundTrunkFor(this.config, "voice_code"),
        voice_challenge: outboundTrunkFor(this.config, "voice_challenge"),
        sms_code: outboundTrunkFor(this.config, "sms_code"),
      },
    };
  }

  async #audit(actorId: string, action: string, targetId: string) {
    await this.#audits.insertOne({
      _id: createId("aud"),
      actorId,
      action,
      targetType: "node",
      targetId,
      occurredAt: new Date(),
    });
  }

  #toResponse(node: NodeDocument): Node {
    return {
      id: node._id,
      name: node.name,
      region: node.region,
      status: node.status,
      secretPrefix: node.secretPrefix,
      secretLastFour: node.secretLastFour,
      enrolledAt: node.enrolledAt.toISOString(),
      lastSeenAt: node.lastSeenAt?.toISOString(),
      revokedAt: node.revokedAt?.toISOString(),
    };
  }
}
