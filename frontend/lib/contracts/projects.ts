import type { VerificationType } from "./verification";

export type IdentityDataMode = "powerotp_pii" | "didit_pii";

export interface Project {
  id: string;
  name: string;
  slug: string;
  apiUrl: string;
  enabledMethods: VerificationType[];
  allowedOrigins: string[];
  callbackUrl?: string;
  callbackConfigured: boolean;
  active: boolean;
  activatedAt: string;
  apiKeyPrefix?: string;
  apiKeyLastFour?: string;
  brandName?: string;
  brandLogoUrl?: string;
  brandReplyToEmail?: string;
  brandHtmlTemplate?: string;
  identityDataMode: IdentityDataMode;
  identifierString: string;
  authRealm: string;
  rpId: string;
  signupHostedUrl: string;
  signinHostedUrl: string;
  stats: {
    total: number;
    succeeded: number;
    failed: number;
    byType: Record<VerificationType, number>;
  };
}

export interface ProjectCreated {
  project: Project;
  apiKey: string;
  callbackSigningSecret?: string;
}

export interface SessionResponse {
  user: {
    id: string;
    email: string;
    accountClass: "customer" | "platform_admin";
    emailVerified: boolean;
  };
  csrfToken: string;
}

export interface SignupResponse {
  status: "already_registered" | "verification_email_queued";
  project?: Project;
  apiKey?: string;
}

// Browser copy of the public password rules. Keep aligned with
// backend/packages/contracts/src/auth.ts when the API policy changes.
export const PASSWORD_REQUIREMENTS: Array<{
  id: string;
  label: string;
  test: (password: string) => boolean;
}> = [
  { id: "length", label: "At least 12 characters", test: (password) => password.length >= 12 },
  { id: "uppercase", label: "One uppercase letter", test: (password) => /[A-Z]/.test(password) },
  { id: "lowercase", label: "One lowercase letter", test: (password) => /[a-z]/.test(password) },
  { id: "digit", label: "One number", test: (password) => /\d/.test(password) },
  {
    id: "special",
    label: "One special character",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];
