import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MeetingInvitationStatus } from "@/lib/database.types";

/**
 * Resend delivery webhook → meeting_invitations ledger.
 *
 * Turns provider delivery signals (delivered / bounced / complained / sent) into
 * durable per-recipient state, so the Portal never again conflates "email accepted
 * by the API" with "guest actually received it". Authenticity is enforced with
 * Resend's Svix signature (RESEND_WEBHOOK_SECRET); an unsigned/invalid request is
 * rejected. No secret is ever logged or returned. Runs service-role (no user
 * session) against the RLS-locked ledger.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOLERANCE_MS = 5 * 60 * 1000;

/** Verify the Svix signature Resend attaches. Returns true only on a valid match. */
function verifySignature(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;

  // Replay window.
  const ts = Number(timestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TOLERANCE_MS) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected);

  // The header is a space-delimited list of `v1,<sig>` entries.
  for (const part of signature.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

/** Map a Resend event type to a ledger status (or null to ignore). */
function statusForEvent(type: string): MeetingInvitationStatus | null {
  switch (type) {
    case "email.delivered":
      return "delivered";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    case "email.failed":
      return "failed";
    case "email.sent":
      return "sent";
    default:
      return null; // delivery_delayed / opened / clicked → not delivery-state changes
  }
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // Without a configured secret we cannot verify authenticity — accept-and-ignore
  // (200) so the provider does not retry-storm, but change nothing.
  if (!secret) return NextResponse.json({ ok: true, ignored: "unconfigured" });

  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const status = statusForEvent(event.type ?? "");
  const messageId = event.data?.email_id;
  if (!status || !messageId) return NextResponse.json({ ok: true, ignored: "no-op" });

  try {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    if (status === "sent") {
      // Never downgrade a terminal state; only promote queued → sent.
      await admin
        .from("meeting_invitations")
        .update({ status: "sent", sent_at: nowIso })
        .eq("resend_message_id", messageId)
        .eq("status", "queued");
    } else if (status === "delivered") {
      await admin
        .from("meeting_invitations")
        .update({ status: "delivered", delivered_at: nowIso })
        .eq("resend_message_id", messageId);
    } else {
      await admin
        .from("meeting_invitations")
        .update({ status })
        .eq("resend_message_id", messageId);
    }
  } catch {
    // A storage hiccup should not make the provider retry forever; we accept and
    // rely on the next signal / manual reconciliation.
    return NextResponse.json({ ok: true, deferred: true });
  }

  return NextResponse.json({ ok: true });
}
