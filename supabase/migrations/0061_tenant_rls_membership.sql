-- ============================================================================
-- Bbettr OS — Multi-Workspace Membership, S2: MEMBERSHIP AUTHORIZATION (0061).
--
-- Teaches the DATABASE AUTHORIZATION layer that a portal user may legitimately
-- belong to MULTIPLE client workspaces, while preserving strict tenant
-- isolation. After S2, membership (client_members / is_client_member()) is the
-- authoritative answer to "may this authenticated user ACCESS Client X?".
--
-- TWO DISTINCT QUESTIONS — keep them apart:
--   • Authorization  ("may this user access Client X?")   → S2 (this migration).
--   • Active workspace("which permitted client is shown?") → S3 (LATER).
-- This migration does ONLY authorization. It does NOT introduce active-workspace
-- selection, a switcher, or any UI.
--
-- HOW EVERY client-tenant policy changes: the client-side predicate
--     client_id = current_client_id()            (single legacy workspace)
-- becomes
--     public.is_client_member(client_id)          (ANY workspace the user is a
--                                                   member of)
-- Admin policies (is_admin(), FOR ALL) are LEFT UNTOUCHED — admins never need a
-- membership. Every NON-tenant predicate on each policy (visibility='client',
-- client_visible, status<>'draft', asset_category IN (…), the success-manager
-- join) is preserved verbatim; only the tenant test is swapped.
--
-- ── BACKWARD COMPATIBILITY (critical) ──────────────────────────────────────
-- current_client_id() is NOT redefined — it still returns profiles.client_id, so
-- the application keeps DISPLAYING each user's legacy/default workspace until S3.
-- For EVERY existing user this change is behaviour-identical: S1 backfilled (and
-- the profiles sync trigger maintains) exactly one membership per client-role
-- profile, so for a single-membership user
--     is_client_member(X)  ⇔  X = profiles.client_id  ⇔  X = current_client_id().
-- A second membership only ever exists once S3/S4 deliberately grants one, and
-- THAT is precisely when RLS should start authorizing the extra workspace.
--
-- DEFENSIVE PRE-STEP: re-assert the S1 backfill (idempotent) so switching the
-- authorization source to membership cannot lock anyone out through a missing
-- membership row.
--
-- Applied atomically as a single migration file (drop+recreate of each policy
-- happen in the same transaction → no authorization gap mid-migration).
-- Additive to the security MODEL only: no table/column/grant/index change, no
-- new function (reuses S1's is_client_member), current_client_id()/profiles
-- guard/client_members policies all untouched.
-- Prereqs: 0001/0002 (base tenant RLS), 0060 (client_members + is_client_member).
-- ============================================================================

-- ── Defensive: guarantee every current relationship has its membership ──────
insert into public.client_members (user_id, client_id, role)
select p.id, p.client_id, 'member'
from public.profiles p
where p.role = 'client' and p.client_id is not null
on conflict (user_id, client_id) do nothing;

-- ── clients (the tenant row itself) ─────────────────────────────────────────
drop policy if exists "Clients read own tenant" on public.clients;
create policy "Clients read own tenant"
  on public.clients for select
  using (public.is_client_member(id));

-- ── client_services ─────────────────────────────────────────────────────────
drop policy if exists "Clients read own services" on public.client_services;
create policy "Clients read own services"
  on public.client_services for select
  using (public.is_client_member(client_id));

-- ── onboarding_submissions (read + client writes) ───────────────────────────
drop policy if exists "Clients read own onboarding" on public.onboarding_submissions;
create policy "Clients read own onboarding"
  on public.onboarding_submissions for select
  using (public.is_client_member(client_id));

drop policy if exists "Clients insert own onboarding" on public.onboarding_submissions;
create policy "Clients insert own onboarding"
  on public.onboarding_submissions for insert
  with check (public.is_client_member(client_id));

drop policy if exists "Clients update own onboarding" on public.onboarding_submissions;
create policy "Clients update own onboarding"
  on public.onboarding_submissions for update
  using (public.is_client_member(client_id))
  with check (public.is_client_member(client_id));

-- ── project_stages ──────────────────────────────────────────────────────────
drop policy if exists "Clients read own stages" on public.project_stages;
create policy "Clients read own stages"
  on public.project_stages for select
  using (public.is_client_member(client_id));

-- ── updates ─────────────────────────────────────────────────────────────────
drop policy if exists "Clients read own updates" on public.updates;
create policy "Clients read own updates"
  on public.updates for select
  using (public.is_client_member(client_id));

-- ── reports ─────────────────────────────────────────────────────────────────
drop policy if exists "Clients read own reports" on public.reports;
create policy "Clients read own reports"
  on public.reports for select
  using (public.is_client_member(client_id));

-- ── files (client-visible read; scoped insert; delete) ──────────────────────
-- Non-tenant predicates preserved: client_visible=true (read), the allowed
-- asset_category set (insert).
drop policy if exists "Clients read own files" on public.files;
create policy "Clients read own files"
  on public.files for select
  using (public.is_client_member(client_id) and client_visible = true);

drop policy if exists "Clients insert own files" on public.files;
create policy "Clients insert own files"
  on public.files for insert
  with check (
    public.is_client_member(client_id)
    and asset_category in ('branding', 'website_content', 'media', 'documents')
  );

drop policy if exists "Clients delete own files" on public.files;
create policy "Clients delete own files"
  on public.files for delete
  using (public.is_client_member(client_id));

-- ── client_section_views (client's own read/insert/update) ──────────────────
drop policy if exists "Clients read own section views" on public.client_section_views;
create policy "Clients read own section views"
  on public.client_section_views for select
  using (public.is_client_member(client_id));

drop policy if exists "Clients insert own section views" on public.client_section_views;
create policy "Clients insert own section views"
  on public.client_section_views for insert
  with check (public.is_client_member(client_id));

drop policy if exists "Clients update own section views" on public.client_section_views;
create policy "Clients update own section views"
  on public.client_section_views for update
  using (public.is_client_member(client_id))
  with check (public.is_client_member(client_id));

-- ── notifications (read + mark-read update) ─────────────────────────────────
drop policy if exists "Clients read own notifications" on public.notifications;
create policy "Clients read own notifications"
  on public.notifications for select
  using (public.is_client_member(client_id));

drop policy if exists "Clients update own notifications" on public.notifications;
create policy "Clients update own notifications"
  on public.notifications for update
  using (public.is_client_member(client_id))
  with check (public.is_client_member(client_id));

-- ── activity_events (client-visible history) ────────────────────────────────
-- Non-tenant predicate preserved: visibility='client'.
drop policy if exists "Clients read own visible activity" on public.activity_events;
create policy "Clients read own visible activity"
  on public.activity_events for select
  using (public.is_client_member(client_id) and visibility = 'client');

-- ── contracts ───────────────────────────────────────────────────────────────
drop policy if exists "Clients read own contracts" on public.contracts;
create policy "Clients read own contracts"
  on public.contracts for select
  using (public.is_client_member(client_id));

-- ── client_invoices (own, non-draft) ────────────────────────────────────────
-- Non-tenant predicate preserved: status<>'draft'. Writes stay admin-only.
drop policy if exists "Clients read own invoices" on public.client_invoices;
create policy "Clients read own invoices"
  on public.client_invoices for select
  using (public.is_client_member(client_id) and status <> 'draft');

-- ── update_reactions (read/add/change/remove own) ───────────────────────────
drop policy if exists "Clients read own update reactions" on public.update_reactions;
create policy "Clients read own update reactions"
  on public.update_reactions for select
  using (public.is_client_member(client_id));

drop policy if exists "Clients add own update reactions" on public.update_reactions;
create policy "Clients add own update reactions"
  on public.update_reactions for insert
  with check (public.is_client_member(client_id));

drop policy if exists "Clients change own update reactions" on public.update_reactions;
create policy "Clients change own update reactions"
  on public.update_reactions for update
  using (public.is_client_member(client_id))
  with check (public.is_client_member(client_id));

drop policy if exists "Clients remove own update reactions" on public.update_reactions;
create policy "Clients remove own update reactions"
  on public.update_reactions for delete
  using (public.is_client_member(client_id));

-- ── update_questions (read + raise own) ─────────────────────────────────────
drop policy if exists "Clients read own update questions" on public.update_questions;
create policy "Clients read own update questions"
  on public.update_questions for select
  using (public.is_client_member(client_id));

drop policy if exists "Clients raise own update questions" on public.update_questions;
create policy "Clients raise own update questions"
  on public.update_questions for insert
  with check (public.is_client_member(client_id));

-- ── client_billing_details (read/insert/update own) ─────────────────────────
drop policy if exists "Clients read own billing details" on public.client_billing_details;
create policy "Clients read own billing details"
  on public.client_billing_details for select
  using (public.is_client_member(client_id));

drop policy if exists "Clients insert own billing details" on public.client_billing_details;
create policy "Clients insert own billing details"
  on public.client_billing_details for insert
  with check (public.is_client_member(client_id));

drop policy if exists "Clients update own billing details" on public.client_billing_details;
create policy "Clients update own billing details"
  on public.client_billing_details for update
  using (public.is_client_member(client_id))
  with check (public.is_client_member(client_id));

-- ── team_members (INDIRECT: a client may read their workspace's success mgr) ─
-- Was: EXISTS a client c where c.id = current_client_id() AND
--      c.success_manager_id = team_members.id. Now membership-aware: any client
-- the user is a MEMBER of whose success_manager_id points at this row.
drop policy if exists "Clients read their success manager" on public.team_members;
create policy "Clients read their success manager"
  on public.team_members for select
  using (
    exists (
      select 1 from public.clients c
      where public.is_client_member(c.id)
        and c.success_manager_id = team_members.id
    )
  );

-- ── Supabase Storage (INDIRECT: object path <client_id>/…) ──────────────────
-- The first path segment is the owning client_id. Was compared to
-- current_client_id()::text; now membership-aware. Implemented as an inline
-- EXISTS on client_members comparing client_id::text to the folder segment, so
-- there is NO cast of the (untrusted) object path to uuid (a malformed name can
-- never raise inside the policy). Admins keep full access via is_admin().
drop policy if exists "Read client files" on storage.objects;
create policy "Read client files"
  on storage.objects for select
  using (
    bucket_id = 'client-files'
    and (
      public.is_admin()
      or exists (
        select 1 from public.client_members m
        where m.user_id = auth.uid()
          and m.client_id::text = (storage.foldername(name))[1]
      )
    )
  );

drop policy if exists "Upload client files" on storage.objects;
create policy "Upload client files"
  on storage.objects for insert
  with check (
    bucket_id = 'client-files'
    and (
      public.is_admin()
      or exists (
        select 1 from public.client_members m
        where m.user_id = auth.uid()
          and m.client_id::text = (storage.foldername(name))[1]
      )
    )
  );

drop policy if exists "Delete client files" on storage.objects;
create policy "Delete client files"
  on storage.objects for delete
  using (
    bucket_id = 'client-files'
    and (
      public.is_admin()
      or exists (
        select 1 from public.client_members m
        where m.user_id = auth.uid()
          and m.client_id::text = (storage.foldername(name))[1]
      )
    )
  );
