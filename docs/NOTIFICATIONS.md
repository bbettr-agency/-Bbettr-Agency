# Client Notifications & Emails

Architecture (V1): **Event → DB notification → Email**. Realtime-ready: the
`notifications` table is the durable event log a future Supabase Realtime
subscription can read with no model change.

```
Admin action ──► notify()  ──►  notifications row  (in-portal feed / future Realtime)
                      └────────►  Resend API → branded email (portal@bbettragency.com)
```

## What sends a notification + email
| Event | Trigger | Type |
|---|---|---|
| New update posted | `postUpdateAction` | `update_posted` |
| Report published | `upsertReportAction` (new report only) | `report_published` |
| Project stage advanced | `setStageStatusAction` → in_progress; `markAssetsReceivedAction` | `stage_advanced` |
| Assets reminder | admin "Send reminder" button | `assets_needed` (action required) |
| Action required | admin "Request action" composer | `action_required` |

Action-required items appear in a prominent banner at the top of the client
dashboard; the client (or an admin) can mark them done (`resolved_at`).

## Two email systems (don't confuse them)
- **Auth emails** (magic link / reset / welcome) → **Supabase Auth → SMTP (Resend SMTP)**.
- **Notification emails** (the table above) → **Resend API directly**
  (`src/lib/email/resend.ts`), because Supabase can't send app-defined emails.

Both send from **portal@bbettragency.com**, reply-to **info@bbettragency.com**.

## Code map
- `src/lib/notifications.ts` — `notify()` choke point (DB + email; best-effort, never throws).
- `src/lib/email/resend.ts` — Resend transactional sender (graceful if key missing).
- `src/lib/email/templates.ts` — reusable branded HTML (header / body / CTA / footer).
- `supabase/migrations/0005_client_notifications.sql` — `notifications` table + RLS.

**Adding a new notification type:** add the enum value (migration), then call
`notify({ type, title, body, link, ... })` from the relevant action. Nothing
else changes.

## Deploy steps
1. Run **`supabase/migrations/0005_client_notifications.sql`** in Supabase.
2. Add **`RESEND_API_KEY`** to Vercel (Production + Preview). Server-only.
3. Ensure the Resend domain **bbettragency.com** is verified and
   **portal@bbettragency.com** is allowed to send.
4. Deploy.

If `RESEND_API_KEY` is missing, notifications are still recorded in the DB (the
in-portal banner/feed works); only the email is skipped.
