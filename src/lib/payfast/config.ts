/**
 * PayFast configuration, read from server-only environment variables. Isolated
 * like the QuickBooks config: if the vars are absent the integration reports
 * "not configured" and the rest of the portal (incl. QuickBooks + EFT) is
 * unaffected — international deals simply don't get a payment link.
 *
 * PayFast processes ZAR only; international clients pay the ZAR invoice by card.
 */

export type PayfastEnvironment = "sandbox" | "live";

export interface PayfastConfig {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  environment: PayfastEnvironment;
  /** Public app origin, e.g. https://portal.bbettragency.com (no trailing /). */
  appUrl: string;
}

export function getPayfastConfig(): PayfastConfig | null {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!merchantId || !merchantKey || !passphrase || !appUrl) return null;

  return {
    merchantId,
    merchantKey,
    passphrase,
    environment: resolvePayfastEnvironment(),
    appUrl: appUrl.replace(/\/$/, ""),
  };
}

/**
 * Resolve PAYFAST_ENVIRONMENT to "live" or "sandbox". Accepts "live",
 * "production" and "prod" (case-insensitive, trimmed) for the live endpoint —
 * "production" mirrors the QBO_ENVIRONMENT convention used elsewhere. Anything
 * else (including unset) is treated as sandbox.
 */
export function resolvePayfastEnvironment(): PayfastEnvironment {
  const raw = (process.env.PAYFAST_ENVIRONMENT ?? "").trim().toLowerCase();
  return raw === "live" || raw === "production" || raw === "prod"
    ? "live"
    : "sandbox";
}

export function isPayfastConfigured(): boolean {
  return getPayfastConfig() !== null;
}

/** PayFast checkout endpoint the signed form POSTs to. */
export function payfastProcessUrl(env: PayfastEnvironment): string {
  return env === "live"
    ? "https://www.payfast.co.za/eng/process"
    : "https://sandbox.payfast.co.za/eng/process";
}

/**
 * Non-secret config snapshot for the admin Integrations page. Surfaces the raw
 * env value, the resolved environment and the active process URL so a live/
 * sandbox mismatch is obvious. Never exposes the merchant key or passphrase.
 */
export interface PayfastDebugInfo {
  configured: boolean;
  /** Exactly what PAYFAST_ENVIRONMENT is set to (or null/empty if unset). */
  rawEnvValue: string | null;
  environment: PayfastEnvironment;
  processUrl: string;
  /** merchant_id is sent in plaintext to PayFast anyway, so safe to show. */
  merchantId: string | null;
  appUrl: string | null;
  /** Boolean only — the passphrase value is never returned. */
  passphraseSet: boolean;
}

export function getPayfastDebugInfo(): PayfastDebugInfo {
  const cfg = getPayfastConfig();
  const environment = resolvePayfastEnvironment();
  return {
    configured: cfg !== null,
    rawEnvValue: process.env.PAYFAST_ENVIRONMENT ?? null,
    environment,
    processUrl: payfastProcessUrl(environment),
    merchantId: process.env.PAYFAST_MERCHANT_ID ?? null,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
    passphraseSet: Boolean(process.env.PAYFAST_PASSPHRASE),
  };
}
