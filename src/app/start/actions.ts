"use server";

import { createProspectIntakeStore } from "@/lib/prospect/intake-store";
import { verifyTurnstileToken } from "@/lib/prospect/turnstile";
import {
  createGenericDraft,
  saveIntakeDraft,
  submitIntake,
  type CreateDraftInput,
  type CreateResult,
  type SaveResult,
  type SubmitResult,
  type SubmitNotification,
  type TurnstileVerifier,
} from "@/lib/prospect/intake-server";
import { notifyAdmins } from "@/lib/internal-notifications";
import { getService } from "@/lib/services";
import type { ServiceType } from "@/lib/database.types";

/**
 * Public prospect-intake server actions (P2-C). The public write boundary:
 * every mutation goes browser → here → service layer (honeypot/Turnstile/token/
 * validation) → service-role store. No anon DB access; no service-role or secret
 * in the client bundle. Results are typed + generic; details are logged server
 * side without PII/token dumps.
 */
const verifier: TurnstileVerifier = { verify: (t) => verifyTurnstileToken(t) };

/** Human service names for the admin notification (no large payloads). */
function describeServices(n: SubmitNotification): string {
  if (n.uncertain) return "Not sure yet";
  if (n.selectedServices.length === 0) return "—";
  return n.selectedServices
    .map((s) => {
      try {
        return getService(s as ServiceType).name;
      } catch {
        return s;
      }
    })
    .join(", ");
}

async function notify(n: SubmitNotification): Promise<void> {
  await notifyAdmins({
    type: "prospect_intake_submitted",
    title: `New intake — ${n.businessName ?? "Unknown business"}`,
    body: `${n.contactName ?? "A prospect"} · ${describeServices(n)}`,
    link: "/admin",
  });
}

export async function createIntakeDraftAction(input: CreateDraftInput): Promise<CreateResult> {
  const res = await createGenericDraft(createProspectIntakeStore(), verifier, input);
  if (res.kind === "save_failed" || res.kind === "configuration_error") {
    console.error(`[intake] createDraft ${res.kind}`); // no PII/token
  }
  return res;
}

export async function saveIntakeDraftAction(
  rawToken: string,
  patch: Record<string, unknown>
): Promise<SaveResult> {
  return saveIntakeDraft(createProspectIntakeStore(), rawToken, patch);
}

export async function submitIntakeAction(args: {
  rawToken: string;
  turnstileToken?: string | null;
  honeypot?: string;
}): Promise<SubmitResult> {
  const res = await submitIntake(
    createProspectIntakeStore(),
    verifier,
    { rawToken: args.rawToken, honeypot: args.honeypot, turnstileToken: args.turnstileToken },
    notify
  );
  if (res.kind === "configuration_error") console.error("[intake] submit configuration_error");
  return res;
}
