export class BotBlockerSiteCredentialError extends Error {
  constructor(
    readonly code:
      | "authentication_required"
      | "botblocker_credentials_unavailable"
      | "idempotency_key_conflict",
    readonly statusCode: number,
  ) {
    super(code);
    this.name = "BotBlockerSiteCredentialError";
  }
}

export class BotBlockerRuntimeError extends Error {
  constructor(
    readonly code:
      | "audience_mismatch"
      | "expired"
      | "invalid_signature"
      | "replay_detected"
      | "idempotency_key_required"
      | "idempotency_key_conflict"
      | "dependency_unavailable",
    readonly statusCode: number,
    readonly unavailable = false,
  ) {
    super(code);
    this.name = "BotBlockerRuntimeError";
  }
}
