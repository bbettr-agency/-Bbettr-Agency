/**
 * Portal email service interface.
 *
 * Kept provider-agnostic so V2 can swap the Supabase implementation for a
 * branded Resend (Bbettr Agency) provider without touching any callers — the
 * admin UI and server actions only depend on this interface.
 */

export type EmailKind =
  | "welcome" // first-time portal access / set password
  | "resend_credentials" // re-send the access link
  | "password_reset"; // reset an existing password

export interface EmailResult {
  ok: boolean;
  error?: string;
}

export interface PortalEmailService {
  /** Send a portal email of the given kind to the recipient. */
  send(kind: EmailKind, email: string): Promise<EmailResult>;
}
