-- ============================================================================
-- Update reactions + the special "Question" follow-up request (additive).
--
-- Lets clients react to project updates with a small set of emoji, and raise a
-- special ❓ "Question" that asks the team for a callback or email. This is NOT
-- a comment system: reactions are a single emoji per person per update, and a
-- question is a one-off, structured follow-up request (channel + optional note)
-- that the team resolves. Nothing here touches billing, QuickBooks, PayFast,
-- Wise, reps, or commissions.
--
--   update_reactions  — one emoji per (update, profile); counts are aggregated
--   update_questions  — one-off callback/email follow-up requests (open/resolved)
--
-- NUMBERING: 0026 (prod runs 0001-0025).
-- ============================================================================

-- ── 1. update_reactions ──────────────────────────────────────────────────────
create table if not exists public.update_reactions (
  id         uuid primary key default gen_random_uuid(),
  update_id  uuid not null references public.updates(id) on delete cascade,
  -- Denormalised owner, so RLS + counts can scope by tenant without a join.
  client_id  uuid not null references public.clients(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  -- One reaction per person per update (changing emoji updates this row).
  unique (update_id, profile_id)
);
create index if not exists update_reactions_update_idx
  on public.update_reactions (update_id);

alter table public.update_reactions enable row level security;

drop policy if exists "Admins manage update reactions" on public.update_reactions;
create policy "Admins manage update reactions"
  on public.update_reactions for all
  using (public.is_admin()) with check (public.is_admin());

-- Clients see all reactions on their own updates (to render counts)…
drop policy if exists "Clients read own update reactions" on public.update_reactions;
create policy "Clients read own update reactions"
  on public.update_reactions for select
  using (client_id = public.current_client_id());

-- …and add / change / remove only their own.
drop policy if exists "Clients add own update reactions" on public.update_reactions;
create policy "Clients add own update reactions"
  on public.update_reactions for insert
  with check (client_id = public.current_client_id());

drop policy if exists "Clients change own update reactions" on public.update_reactions;
create policy "Clients change own update reactions"
  on public.update_reactions for update
  using (client_id = public.current_client_id())
  with check (client_id = public.current_client_id());

drop policy if exists "Clients remove own update reactions" on public.update_reactions;
create policy "Clients remove own update reactions"
  on public.update_reactions for delete
  using (client_id = public.current_client_id());

-- ── 2. update_questions (the special ❓ follow-up) ───────────────────────────
create table if not exists public.update_questions (
  id          uuid primary key default gen_random_uuid(),
  update_id   uuid not null references public.updates(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  channel     text not null check (channel in ('callback', 'email')),
  message     text,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);
create index if not exists update_questions_client_status_idx
  on public.update_questions (client_id, status, created_at desc);

alter table public.update_questions enable row level security;

drop policy if exists "Admins manage update questions" on public.update_questions;
create policy "Admins manage update questions"
  on public.update_questions for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Clients read own update questions" on public.update_questions;
create policy "Clients read own update questions"
  on public.update_questions for select
  using (client_id = public.current_client_id());

drop policy if exists "Clients raise own update questions" on public.update_questions;
create policy "Clients raise own update questions"
  on public.update_questions for insert
  with check (client_id = public.current_client_id());
