-- ============================================================================
-- Files & Assets foundation (Client Intake Automation — Phase A).
--
-- Turns the flat `files` table into a categorised asset platform: a two-level
-- category model (asset_category + subcategory) plus a client-visibility flag.
-- Additive and isolated — nothing here touches QuickBooks, PayFast, commission,
-- onboarding, contracts or intake. The legacy `category` column is KEPT for
-- back-compat (not dropped).
--
-- Storage paths gain an organisational category segment:
--   client-files/<client_id>/<asset_category>/<timestamp>-<file>
-- The bucket RLS keys on the FIRST segment (client_id), so it is unaffected.
--
-- NUMBERING: 0019.
-- ============================================================================

-- Top-level asset groups.
do $$ begin
  create type asset_category as enum (
    'contracts', 'branding', 'website_content', 'media',
    'documents', 'deliverables', 'reports'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.files
  add column if not exists asset_category asset_category not null default 'documents',
  add column if not exists subcategory    text,
  -- Lets admins stage deliverables/reports before releasing them to the client.
  add column if not exists client_visible boolean not null default true;

create index if not exists files_client_asset_idx
  on public.files (client_id, asset_category);

-- Backfill the new model from the legacy `category` enum (one-time, idempotent:
-- only touches rows still on the default 'documents' that have a legacy hint).
update public.files set asset_category = 'branding',        subcategory = 'logo'              where category = 'logo';
update public.files set asset_category = 'branding',        subcategory = 'brand_guidelines'  where category = 'brand_guide';
update public.files set asset_category = 'media',           subcategory = 'images'            where category = 'image';
update public.files set asset_category = 'media',           subcategory = 'videos'            where category = 'video';
update public.files set asset_category = 'documents',       subcategory = 'pdf'               where category = 'pdf';
update public.files set asset_category = 'documents',       subcategory = 'general'           where category = 'document';
update public.files set asset_category = 'reports',         subcategory = 'monthly'           where category = 'report';

-- ── RLS: enforce client-visibility on read + a category allowlist on insert ──
-- Admins keep full access ("Admins manage all files", unchanged).

-- Read: clients see only their own CLIENT-VISIBLE files (hidden staged files stay
-- admin-only).
drop policy if exists "Clients read own files" on public.files;
create policy "Clients read own files"
  on public.files for select
  using (client_id = public.current_client_id() and client_visible = true);

-- Insert: clients may only upload into the client-allowed categories. Contracts,
-- deliverables and reports are admin-managed and cannot be written by clients.
drop policy if exists "Clients insert own files" on public.files;
create policy "Clients insert own files"
  on public.files for insert
  with check (
    client_id = public.current_client_id()
    and asset_category in ('branding', 'website_content', 'media', 'documents')
  );

-- Delete policy unchanged ("Clients delete own files").
