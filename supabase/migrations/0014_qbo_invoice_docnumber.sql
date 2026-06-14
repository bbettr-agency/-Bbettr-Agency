-- ============================================================================
-- Portal-assigned QuickBooks invoice numbers (Phase 2.3). The production QBO
-- company has "Custom transaction numbers" ON but the portal never sent a
-- DocNumber, so QBO left the invoice number blank on the PDF/email. We now
-- assign a unique, sequential portal DocNumber (BBTTR-000001, BBTTR-000002, …)
-- and send it to QuickBooks.
--
-- Additive and isolated: creates one sequence + one function. Touches no
-- existing rows; existing invoices keep their current numbers. Nothing here
-- affects commissions, the approval flow, service packages or PayFast.
--
-- NUMBERING: 0014 (prod runs 0001-0013). PayFast, when built, becomes 0015.
-- ============================================================================

-- Atomic, race-free source of sequential numbers. nextval() is transactional
-- and never returns the same value twice, guaranteeing uniqueness even under
-- concurrent approvals.
create sequence if not exists public.qbo_invoice_docnumber_seq;

-- Continue from the highest portal number already assigned (so re-running or a
-- future re-introduction never restarts). On first run no BBTTR- numbers exist,
-- so this seeds the sequence to return 1 first → BBTTR-000001.
-- is_called = false → the NEXT nextval() returns exactly this value.
do $$
declare
  max_n bigint;
begin
  select coalesce(
           max(substring(quickbooks_invoice_number from '^BBTTR-([0-9]+)$')::bigint),
           0
         )
    into max_n
  from public.invoice_requests
  where quickbooks_invoice_number ~ '^BBTTR-[0-9]+$';

  perform setval('public.qbo_invoice_docnumber_seq', max_n + 1, false);
end $$;

-- Returns the next portal invoice DocNumber, e.g. 'BBTTR-000001'. Called by the
-- service-role client when an invoice is being created.
create or replace function public.next_qbo_invoice_docnumber()
returns text
language sql
volatile
as $$
  select 'BBTTR-' || lpad(nextval('public.qbo_invoice_docnumber_seq')::text, 6, '0');
$$;
