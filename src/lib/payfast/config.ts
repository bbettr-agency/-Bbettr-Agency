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

  const environment: PayfastEnvironment =
    process.env.PAYFAST_ENVIRONMENT === "live" ? "live" : "sandbox";

  return {
    merchantId,
    merchantKey,
    passphrase,
    environment,
    appUrl: appUrl.replace(/\/$/, ""),
  };
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
