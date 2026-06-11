-- ============================================================================
-- Sales Rep Portal hardening.
--
-- Remove the broad "Reps update own deals" policy. No app feature lets a rep
-- edit a deal after submission, but the policy allowed a rep to change their
-- own deal's price/status directly via the API. Reps keep insert + read on
-- their own deals; admins continue to manage all deals. Commission is taken
-- from invoice_requests.amount at approval (which reps cannot update), so this
-- closes a tamper vector with no functional loss.
--
-- Idempotent and additive-safe.
--
-- NOTE: numbering — if the QuickBooks branch (also drafted as 0009) is taken
-- forward later, renumber its migration to 0010 so both can apply in order.
-- ============================================================================

drop policy if exists "Reps update own deals" on deals;
