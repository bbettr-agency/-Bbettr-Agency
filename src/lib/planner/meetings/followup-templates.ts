/**
 * Post-meeting follow-up starting templates (0054). Pure data — importable by
 * the client composer. These are STARTING POINTS: the admin edits subject, body
 * and recipients before sending. Wording is intentionally generic so it fits any
 * meeting type (client, prospect, supplier, call, external contact, …) — it never
 * assumes what the meeting was about.
 *
 * `[First name]` is a placeholder substituted per recipient at send time (from
 * the attendee's stored display name; falls back to "there" when unknown).
 */

export interface FollowUpTemplate {
  key: string;
  label: string;
  subject: string;
  body: string;
}

export const FOLLOWUP_NAME_PLACEHOLDER = "[First name]";

const SIGNOFF = "Kind regards,\nBbettr Agency";

export const FOLLOWUP_TEMPLATES: FollowUpTemplate[] = [
  {
    key: "thanks",
    label: "Simple thank-you",
    subject: "Thank you for your time",
    body:
      `Hi ${FOLLOWUP_NAME_PLACEHOLDER},\n\n` +
      "Thank you for taking the time to meet with us — it was great speaking with you.\n\n" +
      "If anything comes up or you have any questions, just reply to this email and we'll be happy to help.\n\n" +
      SIGNOFF,
  },
  {
    key: "next_steps",
    label: "Thank you + next steps",
    subject: "Thank you — next steps",
    body:
      `Hi ${FOLLOWUP_NAME_PLACEHOLDER},\n\n` +
      "Thank you for your time today — it was great speaking with you.\n\n" +
      "We'll follow up shortly with the next steps we discussed. In the meantime, feel free to reply to this email with any questions.\n\n" +
      SIGNOFF,
  },
  {
    key: "proposal",
    label: "Thank you + proposal coming",
    subject: "Thank you — proposal to follow",
    body:
      `Hi ${FOLLOWUP_NAME_PLACEHOLDER},\n\n` +
      "Thank you for your time today — we really enjoyed the conversation.\n\n" +
      "We'll put together a proposal based on what we discussed and send it through shortly. If anything changes in the meantime, just reply to this email.\n\n" +
      SIGNOFF,
  },
  {
    key: "information",
    label: "Thank you + information/documents",
    subject: "Thank you — information to follow",
    body:
      `Hi ${FOLLOWUP_NAME_PLACEHOLDER},\n\n` +
      "Thank you for your time today — it was great connecting.\n\n" +
      "As discussed, we'll send through the relevant information and documents shortly. If there's anything specific you'd like included, just reply to this email.\n\n" +
      SIGNOFF,
  },
  {
    key: "custom",
    label: "Custom message",
    subject: "",
    body: "",
  },
];

/** First name for personalisation: first token of a display name, else "there". */
export function firstNameFrom(displayName?: string | null): string {
  const trimmed = (displayName ?? "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

/** Substitute the [First name] placeholder for a specific recipient. */
export function personalise(text: string, displayName?: string | null): string {
  return text.split(FOLLOWUP_NAME_PLACEHOLDER).join(firstNameFrom(displayName));
}
