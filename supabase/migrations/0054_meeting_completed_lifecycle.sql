-- ============================================================================
-- Bbettr OS — Meeting completion / post-meeting lifecycle (attended + notes).
--
-- Additive and isolated, in the exact spirit of 0053: completion is modelled as
-- an ANNOTATION, never a status value. The status vocabulary stays
-- ('scheduled','cancelled') — no enum/CHECK widening, no trigger change — so the
-- five lifecycle states are DERIVED, not stored:
--
--   upcoming       status='scheduled' ∧ no_show_at IS NULL ∧ attended_at IS NULL ∧ ends_at >  now()
--   needs_outcome  status='scheduled' ∧ no_show_at IS NULL ∧ attended_at IS NULL ∧ ends_at <= now()
--   completed      status='scheduled' ∧ attended_at IS NOT NULL ∧ no_show_at IS NULL
--   no_show        status='scheduled' ∧ no_show_at   IS NOT NULL ∧ attended_at IS NULL   (0053, unchanged)
--   cancelled      status='cancelled'
--
-- Adds THREE nullable columns + ONE length CHECK + ONE mutual-exclusion CHECK.
-- Like no_show_at, all three columns are structurally excluded from the Google
-- projection desired-state hash (loader.ts selects an explicit column list that
-- omits them), so marking attended / editing notes / recording a follow-up
-- performs NO calendar write and sends NO guest updates.
--
-- Touches NOTHING existing: no status change, no new table, no new index, no RLS
-- policy change, no audit-trigger change, no anon/authenticated grant, no change
-- to 0053 (no_show columns, token, confirm_meeting_reschedule). No backfill —
-- existing past scheduled meetings keep attended_at NULL and therefore derive as
-- 'needs_outcome' until an admin explicitly classifies them.
--
-- NUMBERING: 0054.
-- ============================================================================

alter table public.meetings
  add column attended_at       timestamptz,
  add column outcome_notes     text
    check (outcome_notes is null or char_length(outcome_notes) <= 4000),
  add column thank_you_sent_at timestamptz;

-- Mutual exclusion: a meeting is never simultaneously attended AND a no-show.
-- (App layers guard both "set" paths so this DB check is an unreachable backstop
-- in normal operation; all existing rows have attended_at NULL, so it validates
-- instantly with no backfill.)
alter table public.meetings
  add constraint meetings_outcome_exclusive
    check (attended_at is null or no_show_at is null);

comment on column public.meetings.attended_at is
  'Set when an admin confirms the meeting happened. Annotation, not a status — excluded from the Google projection desired-state hash, so marking attended writes nothing to Google. Cleared by undo or by a manual time reschedule. Mutually exclusive with no_show_at.';
comment on column public.meetings.outcome_notes is
  'Internal-only meeting outcome/notes (max 4000 chars). Never emailed to attendees, never projected to Google.';
comment on column public.meetings.thank_you_sent_at is
  'When a post-meeting follow-up was first genuinely sent (optional, admin-initiated). Historical evidence; preserved across later resends/failures. Delivery is fully decoupled from completion.';
