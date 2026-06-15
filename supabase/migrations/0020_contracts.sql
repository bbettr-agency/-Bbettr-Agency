-- ============================================================================
-- Contracts (Client Intake Automation — Phase B).
--
-- First-class contract records (one-to-many per client), distinct from generic
-- files. A signed contract is stored in the Files & Assets system (category
-- 'contracts') and linked here via file_id. Additive and isolated — nothing
-- here touches QuickBooks, PayFast, commission, onboarding, or intake. (Intake
-- status wiring is Phase C; marking a contract signed does NOT auto-invoice.)
--
-- NUMBERING: 0020.
-- ============================================================================

do $$ begin
  create type contract_status as enum ('not_sent', 'sent', 'signed');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.contracts (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  title           text not null,
  status          contract_status not null default 'not_sent',
  contract_url    text,        -- unsigned agreement to view/sign (external link)
  signed_file_url text,        -- external signed link (e-signature integration, later)
  file_id         uuid references public.files(id) on delete set null, -- signed asset
  sent_at         timestamptz,
  signed_at       timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists contracts_client_id_idx
  on public.contracts (client_id, created_at desc);

alter table public.contracts enable row level security;

-- Admins manage everything.
drop policy if exists "Admins manage contracts" on public.contracts;
create policy "Admins manage contracts"
  on public.contracts for all
  using (public.is_admin())
  with check (public.is_admin());

-- Clients may VIEW their own contracts (download signed docs); they never create
-- or edit them — contracts are admin-managed.
drop policy if exists "Clients read own contracts" on public.contracts;
create policy "Clients read own contracts"
  on public.contracts for select
  using (client_id = public.current_client_id());
