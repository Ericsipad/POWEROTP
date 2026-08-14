import {
  sign as signBytes,
  verify as verifyBytes,
  type KeyLike,
} from "node:crypto";

import {
  BotBlockerPolicySchema,
  canonicalizeBotBlockerArtifact,
  SignedBotBlockerPolicyReleaseSchema,
  SignedSiteClearanceSchema,
  UnsignedSiteClearanceSchema,
  type BotBlockerArtifactType,
  type BotBlockerErrorCode,
  type BotBlockerPolicy,
  type SignedBotBlockerPolicyRelease,
  type SignedSiteClearance,
  type UnsignedSiteClearance,
} from "@powerotp/contracts";

const SIGNING_DOMAIN = "POWEROTP_BOTBLOCKER_ED25519_V1";

export interface BotBlockerArtifactClaims<T> {
  artifactType: BotBlockerArtifactType;
  keyId: string;
  audience: string;
  siteId: string;
  sessionId?: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  payload: T;
}

export type BotBlockerVerificationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: BotBlockerErrorCode; reason: string };

interface VerifyArtifactOptions<T> {
  claims: BotBlockerArtifactClaims<T>;
  signature: string;
  publicKeys: Readonly<Record<string, KeyLike | undefined>>;
  expectedAudience: string;
  expectedSiteId: string;
  expectedSessionId?: string;
  expectedNonce?: string;
  now?: number;
}

export function signBotBlockerArtifact<T>(
  claims: BotBlockerArtifactClaims<T>,
  privateKey: KeyLike,
): string {
  return signBytes(null, signingBytes(claims), privateKey).toString("base64url");
}

export function verifyBotBlockerArtifact<T>(
  options: VerifyArtifactOptions<T>,
): BotBlockerVerificationResult<BotBlockerArtifactClaims<T>> {
  const { claims } = options;
  const now = options.now ?? Date.now();

  if (claims.audience !== options.expectedAudience) {
    return failure("audience_mismatch", "The artifact audience does not match");
  }
  if (claims.siteId !== options.expectedSiteId) {
    return failure("invalid_signature", "The artifact site binding does not match");
  }
  if (
    options.expectedSessionId !== undefined &&
    claims.sessionId !== options.expectedSessionId
  ) {
    return failure("invalid_signature", "The artifact session binding does not match");
  }
  if (options.expectedNonce !== undefined && claims.nonce !== options.expectedNonce) {
    return failure("invalid_signature", "The artifact nonce does not match");
  }
  if (claims.expiresAt <= now) {
    return failure("expired", "The artifact has expired");
  }
  if (claims.issuedAt > now) {
    return failure("invalid_signature", "The artifact was issued in the future");
  }

  const publicKey = options.publicKeys[claims.keyId];
  if (!publicKey) {
    return failure("invalid_signature", "The signing key is not trusted");
  }

  try {
    const signature = Buffer.from(options.signature, "base64url");
    if (
      signature.length !== 64 ||
      !verifyBytes(null, signingBytes(claims), publicKey, signature)
    ) {
      return failure("invalid_signature", "The Ed25519 signature is invalid");
    }
  } catch {
    return failure("invalid_signature", "The Ed25519 signature is malformed");
  }

  return { ok: true, value: claims };
}

export function signSiteClearance(
  unsignedClearance: UnsignedSiteClearance,
  keyId: string,
  privateKey: KeyLike,
): SignedSiteClearance {
  const clearance = UnsignedSiteClearanceSchema.parse(unsignedClearance);
  const claims = clearanceClaims(clearance, keyId);
  return SignedSiteClearanceSchema.parse({
    ...clearance,
    signatureStatus: "signed",
    keyId,
    signature: signBotBlockerArtifact(claims, privateKey),
  });
}

export function verifySiteClearance(options: {
  clearance: unknown;
  publicKeys: Readonly<Record<string, KeyLike | undefined>>;
  expectedAudience: string;
  expectedSiteId: string;
  expectedGateSessionId: string;
  expectedNonce?: string;
  now?: number;
}): BotBlockerVerificationResult<SignedSiteClearance> {
  const parsed = SignedSiteClearanceSchema.safeParse(options.clearance);
  if (!parsed.success) {
    return failure("invalid_signature", "The signed clearance is malformed");
  }
  const clearance = parsed.data;
  const verified = verifyBotBlockerArtifact({
    claims: clearanceClaims(clearance, clearance.keyId),
    signature: clearance.signature,
    publicKeys: options.publicKeys,
    expectedAudience: options.expectedAudience,
    expectedSiteId: options.expectedSiteId,
    expectedSessionId: options.expectedGateSessionId,
    expectedNonce: options.expectedNonce,
    now: options.now,
  });
  return verified.ok ? { ok: true, value: clearance } : verified;
}

export function signBotBlockerPolicyRelease(options: {
  policy: BotBlockerPolicy;
  keyId: string;
  audience: string;
  nonce: string;
  issuedAt: number;
  privateKey: KeyLike;
}): SignedBotBlockerPolicyRelease {
  const policy = BotBlockerPolicySchema.parse(options.policy);
  const claims = policyClaims({
    policy,
    keyId: options.keyId,
    audience: options.audience,
    nonce: options.nonce,
    issuedAt: options.issuedAt,
  });
  return SignedBotBlockerPolicyReleaseSchema.parse({
    signatureStatus: "signed",
    keyId: options.keyId,
    signature: signBotBlockerArtifact(claims, options.privateKey),
    audience: options.audience,
    nonce: options.nonce,
    issuedAt: options.issuedAt,
    policy,
  });
}

export function verifyBotBlockerPolicyRelease(options: {
  release: unknown;
  publicKeys: Readonly<Record<string, KeyLike | undefined>>;
  expectedAudience: string;
  expectedSiteId: string;
  expectedNonce?: string;
  now?: number;
}): BotBlockerVerificationResult<SignedBotBlockerPolicyRelease> {
  const parsed = SignedBotBlockerPolicyReleaseSchema.safeParse(options.release);
  if (!parsed.success) {
    return failure("invalid_signature", "The signed policy release is malformed");
  }
  const release = parsed.data;
  const verified = verifyBotBlockerArtifact({
    claims: policyClaims(release),
    signature: release.signature,
    publicKeys: options.publicKeys,
    expectedAudience: options.expectedAudience,
    expectedSiteId: options.expectedSiteId,
    expectedNonce: options.expectedNonce,
    now: options.now,
  });
  return verified.ok ? { ok: true, value: release } : verified;
}

function clearanceClaims(
  clearance: Omit<SignedSiteClearance, "keyId" | "signature"> | UnsignedSiteClearance,
  keyId: string,
): BotBlockerArtifactClaims<Record<string, never>> {
  return {
    artifactType: "site_clearance",
    keyId,
    audience: clearance.audience,
    siteId: clearance.siteId,
    sessionId: clearance.gateSessionId,
    nonce: clearance.nonce,
    issuedAt: clearance.issuedAt,
    expiresAt: clearance.expiresAt,
    payload: {},
  };
}

function policyClaims(release: {
  policy: BotBlockerPolicy;
  keyId: string;
  audience: string;
  nonce: string;
  issuedAt: number;
}): BotBlockerArtifactClaims<BotBlockerPolicy> {
  return {
    artifactType: "policy_release",
    keyId: release.keyId,
    audience: release.audience,
    siteId: release.policy.siteId,
    nonce: release.nonce,
    issuedAt: release.issuedAt,
    expiresAt: release.policy.expiresAt,
    payload: release.policy,
  };
}

function signingBytes<T>(claims: BotBlockerArtifactClaims<T>): Buffer {
  return Buffer.from(
    canonicalizeBotBlockerArtifact({ domain: SIGNING_DOMAIN, ...claims }),
    "utf8",
  );
}

function failure<T>(
  code: BotBlockerErrorCode,
  reason: string,
): BotBlockerVerificationResult<T> {
  return { ok: false, code, reason };
}
