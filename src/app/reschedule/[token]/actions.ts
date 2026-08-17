"use server";

import { confirmRescheduleByToken, type ConfirmResult } from "@/lib/planner/meetings/reschedule-service";

/**
 * Public confirm action. Authorization is the raw token alone (from the URL the
 * client already holds); no session. All revalidation + the atomic, service-role
 * confirm happen server-side in confirmRescheduleByToken — this is a thin edge.
 */
export async function confirmRescheduleAction(
  token: string,
  slotStartIso: string
): Promise<ConfirmResult> {
  return confirmRescheduleByToken(token, slotStartIso);
}
