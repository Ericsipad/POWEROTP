function publicUrl(base: string, path: string): string {
  return new URL(path, base).toString();
}

export function verificationStatusUrl(apiBase: string, interactionId: string): string {
  return publicUrl(apiBase, `/v1/verifications/${interactionId}`);
}

export function demoVerificationStatusUrl(apiBase: string, interactionId: string): string {
  return publicUrl(apiBase, `/v1/demo/verifications/${interactionId}`);
}

export function projectVerificationUrl(apiBase: string, projectSlug: string): string {
  return publicUrl(apiBase, `/v1/projects/${projectSlug}/verifications`);
}

export function modalSessionUrl(appBase: string, sessionId: string): string {
  return publicUrl(appBase, `/widget/${sessionId}`);
}
