import type { ProductionConfig } from "./config.js";

export interface EmailService {
  sendVerification(email: string, token: string): Promise<void>;
}

export function createBrevoEmailService(
  config: Pick<ProductionConfig, "BREVO_API_KEY" | "EMAIL_FROM" | "PUBLIC_APP_URL">,
): EmailService {
  return {
    async sendVerification(email, token) {
      const verificationUrl = new URL("/verify-email", config.PUBLIC_APP_URL);
      verificationUrl.hash = new URLSearchParams({ token }).toString();

      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": config.BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: "POWEROTP", email: config.EMAIL_FROM },
          to: [{ email }],
          subject: "Verify your POWEROTP account",
          htmlContent: `<p>Verify your POWEROTP account:</p><p><a href="${verificationUrl.toString()}">Verify email</a></p><p>This link expires in one hour.</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Brevo rejected verification email with HTTP ${response.status}`);
      }
    },
  };
}
