import type { ProductionConfig } from "./config.js";

const CODE_PLACEHOLDER = "{{CODE}}";

export interface EmailOtpBranding {
  brandName?: string;
  brandLogoUrl?: string;
  /** Sets the email's `replyTo` — independent of `sender`/"From" and needs
   * no domain verification, unlike the "From" address itself (see this
   * function's own doc comment for why "From" always stays our own
   * verified sender). */
  brandReplyToEmail?: string;
  /** The customer's own full HTML email body, containing the literal
   * `{{CODE}}` placeholder (enforced by `BrandHtmlTemplateSchema`) —
   * replaces the auto-generated brand-name/logo template entirely when
   * set. Substituted, never parsed or otherwise modified. */
  brandHtmlTemplate?: string;
}

export interface EmailOtpService {
  sendOtpCode(targetEmail: string, code: string, branding?: EmailOtpBranding): Promise<void>;
}

export class EmailOtpProviderError extends Error {
  constructor(readonly reasonCode: "provider_rejected" | "provider_unavailable") {
    super(reasonCode);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function defaultTemplate(brandLabel: string, brandLogoUrl: string | undefined, code: string): string {
  const logoHtml = brandLogoUrl
    ? `<img src="${escapeHtml(brandLogoUrl)}" alt="${escapeHtml(brandLabel)}" style="max-height:48px;margin-bottom:20px;" />`
    : "";
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      ${logoHtml}
      <h1 style="font-size: 22px; margin: 0 0 12px;">Your ${escapeHtml(brandLabel)} verification code</h1>
      <p style="color: #55645d; line-height: 1.6;">Enter this code to continue:</p>
      <p style="font-size: 32px; font-weight: 800; letter-spacing: 6px; margin: 24px 0;">${code}</p>
      <p style="color: #92a099; font-size: 13px;">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
    </div>`;
}

/**
 * Sends an `email_code` verification code over Brevo — kept as its own
 * module rather than folded into `apps/api/src/email.ts` (which only ever
 * sends the fixed account-signup-verification email and operator alerts):
 * this one renders a different template per send, branded with the owning
 * project's own branding snapshot (see
 * `apps/api/src/verification-service.ts`), never POWEROTP's own identity —
 * an end user receiving this email is the *customer's* end user, not a
 * POWEROTP account holder. Falls back to a plain "POWEROTP" sender/heading
 * whenever a project has no branding configured.
 *
 * The "From" address (`sender.email`) always stays our own verified
 * `EMAIL_FROM` — Brevo (like every ESP) requires the From domain to be
 * authenticated in the sending account, so we can't send "From" an
 * arbitrary customer's own domain without them individually verifying it
 * in *our* Brevo account, which doesn't scale across many customers. The
 * From *display name* is fully customer-controlled (`sender.name`), and
 * `replyTo` is completely independent of `sender` and needs no
 * verification at all — so a customer's own reply-to address (
 * `brandReplyToEmail`) is the real, fully-supported way for their end
 * users' replies to reach them directly.
 */
export function createBrevoEmailOtpService(
  config: Pick<ProductionConfig, "BREVO_API_KEY" | "EMAIL_FROM">,
  fetchImpl: typeof fetch = fetch,
): EmailOtpService {
  return {
    async sendOtpCode(targetEmail, code, branding) {
      const brandLabel = branding?.brandName?.trim() || "POWEROTP";
      const htmlContent = branding?.brandHtmlTemplate
        ? branding.brandHtmlTemplate.replaceAll(CODE_PLACEHOLDER, code)
        : defaultTemplate(brandLabel, branding?.brandLogoUrl, code);

      const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": config.BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: brandLabel, email: config.EMAIL_FROM },
          to: [{ email: targetEmail }],
          ...(branding?.brandReplyToEmail ? { replyTo: { email: branding.brandReplyToEmail } } : {}),
          subject: `Your ${brandLabel} verification code`,
          htmlContent,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        // Same non-2xx-only diagnostic convention as apps/api/src/sms.ts —
        // never logs the code or recipient address.
        console.error(
          JSON.stringify({
            service: "powerotp-api",
            component: "email-otp",
            msg: "Brevo rejected an email_code send",
            status: response.status,
          }),
        );
        throw new EmailOtpProviderError(
          response.status >= 500 ? "provider_unavailable" : "provider_rejected",
        );
      }
    },
  };
}
