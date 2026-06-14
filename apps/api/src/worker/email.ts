// Minimal Resend-backed email sender. No-ops gracefully when RESEND_API_KEY / EMAIL_FROM are
// unset so local dev and tests don't require email configuration.

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type SendEmailResult = { sent: boolean; skipped?: string; error?: string };

export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

export async function sendEmail(env: Env, params: SendEmailParams): Promise<SendEmailResult> {
  if (!isEmailConfigured(env)) {
    // Surface the link in logs during local dev so the invite flow is still testable.
    console.warn(`Email not configured (RESEND_API_KEY/EMAIL_FROM); skipped sending "${params.subject}" to ${params.to}.`);
    return { sent: false, skipped: "email_not_configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM!.trim(),
        to: [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {})
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Resend send failed (${response.status}) to ${params.to}: ${body}`);
      return { sent: false, error: `Resend returned ${response.status}.` };
    }
    return { sent: true };
  } catch (error) {
    console.error(`Resend send threw for ${params.to}:`, error);
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Resolves the public base URL used in invite links (env override → request origin → localhost). */
export function appBaseUrl(env: Env, request?: Request): string {
  const explicit = env.APP_PUBLIC_URL?.trim() || env.BETTER_AUTH_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  if (request) {
    try {
      return new URL(request.url).origin;
    } catch {
      // fall through
    }
  }
  return "http://localhost:5173";
}

export function buildChallengeInviteEmail(params: {
  inviterName: string;
  claim: string;
  challengeUrl: string;
  requiredAppNames: string[];
}): { subject: string; html: string; text: string } {
  const apps = params.requiredAppNames.length ? params.requiredAppNames.join(", ") : "your accounts";
  const subject = `${params.inviterName} challenged you on Moltbooky`;
  const text = [
    `${params.inviterName} challenged you head-to-head on Moltbooky:`,
    "",
    `"${params.claim}"`,
    "",
    `To accept, sign in with this email address, connect ${apps}, and stake.`,
    params.challengeUrl,
    "",
    "If you weren't expecting this, you can ignore this email."
  ].join("\n");
  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">`,
    `<p style="font-size:15px;line-height:1.6"><strong>${escapeHtml(params.inviterName)}</strong> challenged you head-to-head on Moltbooky:</p>`,
    `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #6366f1;background:#f8fafc;font-size:16px;line-height:1.5">${escapeHtml(params.claim)}</blockquote>`,
    `<p style="font-size:14px;line-height:1.6;color:#475569">To accept, sign in with <strong>this email address</strong>, connect ${escapeHtml(apps)}, and stake. The resolver compares you both at expiry.</p>`,
    `<p style="margin:24px 0"><a href="${encodeURI(params.challengeUrl)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Accept the challenge</a></p>`,
    `<p style="font-size:12px;color:#94a3b8;line-height:1.5">If you weren't expecting this, you can ignore this email.</p>`,
    `</div>`
  ].join("");
  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
