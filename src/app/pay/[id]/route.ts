import { buildPayfastRedirect } from "@/lib/payfast";

/**
 * Public PayFast checkout hand-off. An international client opens
 * /pay/<m_payment_id>; we render a minimal auto-submitting form that POSTs the
 * signed fields to PayFast's checkout. No auth — the payer isn't a portal user.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const redirect = await buildPayfastRedirect(id);

  if (!redirect) {
    return new Response(
      "<!doctype html><meta charset='utf-8'><p>Payment link not found or unavailable.</p>",
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const inputs = redirect.fields
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`
    )
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Redirecting to secure payment…</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center">
<p>Redirecting you to the secure PayFast checkout…</p>
<form action="${escapeHtml(redirect.actionUrl)}" method="post">${inputs}
<noscript><button type="submit">Continue to PayFast</button></noscript>
</form>
<script>document.forms[0].submit();</script>
</body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
