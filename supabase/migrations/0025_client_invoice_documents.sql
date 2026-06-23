-- ============================================================================
-- Client-facing invoice visibility (additive to E1 / 0023).
--
-- This does NOT introduce billing automation, payment processing, recurring
-- invoices, or any QuickBooks/PayFast/Wise/rep changes. It simply lets admins
-- attach a manually-produced invoice PDF to an existing E1 `client_invoices`
-- row and lets the owning client VIEW/DOWNLOAD their non-draft invoices in the
-- portal. QuickBooks remains the source of truth for creating invoices.
--
-- Three additive changes, nothing destructive:
--   1. client_invoices.file_id     — link to the uploaded PDF (Files & Assets)
--   2. client_invoices.reminded_at — last manual reminder timestamp (UX only)
--   3. asset_category += 'invoices'— a dedicated, admin-only file home
--   4. Client SELECT RLS on client_invoices (own, non-draft) — read-only access
--
-- "Overdue" stays DERIVED in queries (status='sent' AND due_at < now()); no new
-- status value and no scheduled job. Drafts remain admin-only (RLS excludes
-- them), so a draft invoice is never visible to the client.
--
-- NUMBERING: 0025 (prod runs 0001-0024).
-- ============================================================================

-- ── 1. PDF link + reminder timestamp on the existing E1 ledger ───────────────
alter table public.client_invoices
  add column if not exists file_id     uuid references public.files(id) on delete set null,
  add column if not exists reminded_at timestamptz;

-- ── 2. Dedicated asset category for invoice PDFs (admin-managed) ─────────────
-- PG15 allows ADD VALUE inside a migration transaction; the value is not USED
-- in this same migration, so this is safe.
alter type public.asset_category add value if not exists 'invoices';

-- ── 3. Client read access: own, non-draft invoices only ──────────────────────
-- E1 was admin-only by design ("client-facing access deferred to a later
-- phase"). This is that phase: clients may VIEW their invoices; they never
-- create, edit, or change status — that stays admin-only via the existing
-- "Admins manage client invoices" policy.
drop policy if exists "Clients read own invoices" on public.client_invoices;
create policy "Clients read own invoices"
  on public.client_invoices for select
  using (
    client_id = public.current_client_id()
    and status <> 'draft'
  );
