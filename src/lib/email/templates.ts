/**
 * Reusable, email-client-safe HTML templates for Bbettr Agency transactional
 * emails. Built from composable pieces (header / body / CTA button / footer)
 * with inline styles and table layout for maximum deliverability/compatibility.
 *
 * Add a new email by composing `renderEmail(...)` — no other code changes.
 */

const BRAND = "#38B6FF";
const INK = "#0f1729";
const MUTED = "#63718d";
const BORDER = "#eceef2";

export interface EmailContent {
  /** Preheader text shown in inbox preview. */
  preheader?: string;
  heading: string;
  /** Paragraphs of body copy (plain text; rendered as <p>). */
  paragraphs: string[];
  cta?: { label: string; url: string };
  /** Optional small note under the CTA. */
  footnote?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function header(): string {
  return `
  <tr><td style="padding:28px 32px 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:40px;height:40px;background:${BRAND};border-radius:10px;text-align:center;vertical-align:middle;">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:#ffffff;">B</span>
      </td>
      <td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;color:${INK};">
        Bbettr&nbsp;Agency
      </td>
    </tr></table>
  </td></tr>`;
}

function footer(): string {
  return `
  <tr><td style="padding:24px 32px 28px;border-top:1px solid ${BORDER};">
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${MUTED};">
      You're receiving this because you're a Bbettr Agency client.<br/>
      Questions? Just reply to this email or contact
      <a href="mailto:info@bbettragency.com" style="color:${BRAND};text-decoration:none;">info@bbettragency.com</a>.
    </p>
    <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#aeb7c8;">
      © ${new Date().getFullYear()} Bbettr Agency · portal.bbettragency.com
    </p>
  </td></tr>`;
}

function ctaButton(label: string, url: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr>
    <td style="background:${BRAND};border-radius:10px;">
      <a href="${escapeHtml(url)}" target="_blank"
         style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">
        ${escapeHtml(label)}
      </a>
    </td>
  </tr></table>`;
}

/** Compose a full branded HTML email. */
export function renderEmail(content: EmailContent): string {
  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:${INK};">${escapeHtml(
          p
        )}</p>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/></head>
<body style="margin:0;padding:0;background:#f6f7f9;">
  ${
    content.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
          content.preheader
        )}</div>`
      : ""
  }
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:540px;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">
        ${header()}
        <tr><td style="padding:8px 32px 24px;">
          <h1 style="margin:8px 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:27px;font-weight:800;color:${INK};">
            ${escapeHtml(content.heading)}
          </h1>
          ${paragraphs}
          ${content.cta ? ctaButton(content.cta.label, content.cta.url) : ""}
          ${
            content.footnote
              ? `<p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};">${escapeHtml(
                  content.footnote
                )}</p>`
              : ""
          }
        </td></tr>
        ${footer()}
      </table>
    </td></tr>
  </table>
</body></html>`;
}
