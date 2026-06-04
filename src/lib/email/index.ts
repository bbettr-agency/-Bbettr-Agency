import type { PortalEmailService } from "./types";
import { supabaseEmailService } from "./supabase-service";

/**
 * Returns the active portal email service. V1 uses Supabase's built-in emails.
 *
 * To move to branded Bbettr Agency emails in V2, implement a `resendService`
 * against `PortalEmailService` and switch here (e.g. based on an
 * `EMAIL_PROVIDER` env var) — no caller changes required.
 */
export function getEmailService(): PortalEmailService {
  return supabaseEmailService;
}

export type { EmailKind, EmailResult, PortalEmailService } from "./types";
