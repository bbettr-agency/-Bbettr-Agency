-- ============================================================================
-- Deal ↔ Client linkage observers (Client Intake Automation — Phase D2).
--
-- Auto-advances a NEW client's intake_status when their LINKED deal is invoiced
-- or paid, by observing the TABLE WRITES (not the application code) — so the
-- QuickBooks invoicing path and the PayFast ITN webhook both trigger it WITHOUT
-- any edits to those files. Additive and isolated: nothing here changes
-- QuickBooks, PayFast, commissions, the approval flow, or the manual "Mark
-- Invoice Sent / Mark Invoice Paid" controls.
--
-- Safety: forward-only + new-clients-only (mirrors the app-side
-- advanceIntakeStatus guard), so legacy clients are never moved and a client's
-- status can never go backwards. Audit events are INTERNAL (admin-only); nothing
-- new is shown on the client-facing timeline.
--
-- Pipeline (from 0021):
--   draft → contract_sent → contract_signed → invoice_sent → paid
--         → portal_access_sent → onboarding_started → onboarding_submitted
--
-- NUMBERING: 0022 (prod runs 0001-0021).
-- ============================================================================

-- ── 1. Integrity: one linked deal per client ────────────────────────────────
-- A portal client maps to at most one active deal. Only constrains non-null
-- values, so the many unlinked deals (client_id IS NULL) are unaffected. Safe to
-- add today because client_id is currently NULL for every deal.
create unique index if not exists deals_client_id_unique
  on public.deals (client_id)
  where client_id is not null;

-- ── 2. Guarded intake advance + internal audit event ────────────────────────
-- Mirrors the app-side advanceIntakeStatus(): only NEW clients, only a FORWARD
-- move from an allowed prior status. SECURITY DEFINER so it can update clients +
-- insert activity_events regardless of the writer's RLS (the PayFast ITN and QBO
-- invoice writes run under the service role; this keeps behaviour uniform).
create or replace function public.advance_intake(
  p_client_id    uuid,
  p_target       intake_status,
  p_allowed_from intake_status[],
  p_event_type   text,
  p_event_title  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type   onboarding_type;
  v_status intake_status;
begin
  if p_client_id is null then
    return;
  end if;

  select onboarding_type, intake_status
    into v_type, v_status
    from public.clients
   where id = p_client_id;

  if not found then
    return;
  end if;

  -- Only new clients; only a forward move from an allowed prior status.
  if v_type is distinct from 'new' then
    return;
  end if;
  if not (v_status = any (p_allowed_from)) then
    return;
  end if;

  update public.clients
     set intake_status = p_target
   where id = p_client_id;

  -- Internal-only audit event (admins only; hidden from the client timeline).
  insert into public.activity_events (client_id, type, title, visibility, source)
  values (p_client_id, p_event_type, p_event_title, 'internal', 'system');
end;
$$;

-- ── 3. Observer: invoice_request → 'invoiced'  ⇒  intake 'invoice_sent' ──────
-- Fires for every path that invoices a request (approve + retry, via the QBO
-- lib) without touching that code. Resolves the client through the deal link.
create or replace function public.invoice_request_intake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  if new.status = 'invoiced' and new.status is distinct from old.status then
    select d.client_id into v_client_id
      from public.deals d
     where d.id = new.deal_id;

    perform public.advance_intake(
      v_client_id,
      'invoice_sent',
      array['draft', 'contract_sent', 'contract_signed']::intake_status[],
      'invoice_sent',
      'Invoice sent'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_request_intake on public.invoice_requests;
create trigger trg_invoice_request_intake
  after update on public.invoice_requests
  for each row execute function public.invoice_request_intake_advance();

-- ── 4. Observer: payfast_payment → 'paid'  ⇒  intake 'paid' ──────────────────
-- Covers BOTH the manual admin "Mark as paid" AND the verified PayFast ITN —
-- both UPDATE this row, so a single DB trigger handles them without editing the
-- ITN file. Resolves the client via the payment's deal_id, falling back to the
-- invoice_request's deal when deal_id was not stored on the payment.
create or replace function public.payfast_payment_intake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  if new.status = 'paid' and new.status is distinct from old.status then
    select coalesce(
             (select d.client_id from public.deals d where d.id = new.deal_id),
             (select d.client_id
                from public.invoice_requests ir
                join public.deals d on d.id = ir.deal_id
               where ir.id = new.invoice_request_id)
           )
      into v_client_id;

    perform public.advance_intake(
      v_client_id,
      'paid',
      array['draft', 'contract_sent', 'contract_signed', 'invoice_sent']::intake_status[],
      'invoice_paid',
      'Payment received'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payfast_payment_intake on public.payfast_payments;
create trigger trg_payfast_payment_intake
  after update on public.payfast_payments
  for each row execute function public.payfast_payment_intake_advance();
