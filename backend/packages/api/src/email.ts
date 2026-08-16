import type { ProductionConfig } from "./config.js";

export interface EmailService {
  sendVerification(email: string, token: string): Promise<void>;
  /** Operator alerting (see `backend/packages/api/src/alerting-service.ts` and
   * `alert-dispatcher.ts`) — a plain-text message, no template. */
  sendAdminAlert(to: string, message: string): Promise<void>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createBrevoEmailService(
  config: Pick<
    ProductionConfig,
    "BREVO_API_KEY" | "EMAIL_FROM" | "PUBLIC_APP_URL" | "POWEROTP_SIGNUP_EMAIL_TEMPLATE_ID"
  >,
): EmailService {
  return {
    async sendVerification(email, token) {
      const verificationUrl = new URL("/verify-email", config.PUBLIC_APP_URL);
      verificationUrl.hash = new URLSearchParams({ token }).toString();

      // A Brevo dashboard template (see docs/AS_BUILT.md's "Customer signup
      // flow" section for the HTML to paste in) is preferred once
      // configured; falls back to the original inline HTML so verification
      // emails keep working before an operator sets it up.
      const body = config.POWEROTP_SIGNUP_EMAIL_TEMPLATE_ID
        ? {
            sender: { name: "POWEROTP", email: config.EMAIL_FROM },
            to: [{ email }],
            templateId: Number(config.POWEROTP_SIGNUP_EMAIL_TEMPLATE_ID),
            params: { VERIFY_URL: verificationUrl.toString() },
          }
        : {
            sender: { name: "POWEROTP", email: config.EMAIL_FROM },
            to: [{ email }],
            subject: "Verify your POWEROTP account",
            htmlContent: `<p>Verify your POWEROTP account:</p><p><a href="${verificationUrl.toString()}">Verify email</a></p><p>This link expires in one hour.</p>`,
          };

      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": config.BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Brevo rejected verification email with HTTP ${response.status}`);
      }
    },
    async sendAdminAlert(to, message) {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": config.BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: "POWEROTP", email: config.EMAIL_FROM },
          to: [{ email: to }],
          subject: "POWEROTP operator alert",
          htmlContent: `<p>${escapeHtml(message)}</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Brevo rejected alert email with HTTP ${response.status}`);
      }
    },
  };
}
