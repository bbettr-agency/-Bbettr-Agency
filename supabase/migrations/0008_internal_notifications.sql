-- ============================================================================
-- Internal notifications — in-app notifications for ADMINS and REPS, addressed
-- by recipient (a profiles/auth user). Separate from the client-facing
-- `notifications` table (which is tenant-addressed), so the client system is
-- untouched. Reuses the same read_at / unread-count UX.
--
-- Rows are written server-side via the service-role client (see
-- src/lib/internal-notifications.ts), so no INSERT policy is needed for reps.
-- ============================================================================

create type internal_notification_type as enum (
  -- admin-facing
  'deal_submitted',
  'invoice_request',
  'rep_created',
  'rep_deactivated',
  'maintenance_toggled',
  -- rep-facing
  'invoice_approved',
  'invoice_rejected',
  'commission_recorded',
  'deal_status',
  'admin_comment'
);

create table internal_notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  type         internal_notification_type not null,
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index internal_notifications_recipient_idx
  on internal_notifications(recipient_id, created_at desc);

alter table internal_notifications enable row level security;

-- Recipients read and mark their own as read.
create policy "Read own internal notifications"
  on internal_notifications for select
  using (recipient_id = auth.uid());

create policy "Update own internal notifications"
  on internal_notifications for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Admins can manage all (writes generally happen via the service role).
create policy "Admins manage internal notifications"
  on internal_notifications for all
  using (is_admin())
  with check (is_admin());
