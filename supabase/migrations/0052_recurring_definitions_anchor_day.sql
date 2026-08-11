-- ============================================================================
-- Bbettr OS — Planner Recurring Reminders: monthly anchor (migration 0052).
--
-- Adds ONE additive, nullable column to recurring_definitions so monthly
-- recurrence can keep the INTENDED day-of-month and clamp only for shorter
-- months, WITHOUT permanent drift:
--     31 Jan → 28/29 Feb → 31 Mar → 30 Apr → 31 May …
-- `next_occurrence` is a `date` and literally cannot store "31 Feb", so once it
-- clamps to the 28th a naive "+1 month" would drift to the 28th forever. The
-- stable `anchor_day` (the series' original day-of-month) is what the pure date
-- engine clamps each step, which is why it must be persisted separately.
--
-- STRICT SCOPE — this migration ONLY:
--   * adds recurring_definitions.anchor_day smallint (nullable) + CHECK 1..31
-- It changes NO RLS, NO trigger, NO other table/column, and NO existing
-- recurrence behaviour. occurrence_slot remains the durable per-occurrence
-- business/idempotency key (unchanged). Nothing is live to backfill.
--
-- NUMBERING: 0052. Prereq: 0041 (recurring_definitions).
-- ============================================================================

alter table public.recurring_definitions
  add column if not exists anchor_day smallint;

-- Intended day-of-month for monthly rules (1..31). Nullable: day/week rules and
-- any pre-existing rows leave it null; the generator sets it at creation for
-- monthly definitions. Guarded add so re-applying the migration is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_definitions_anchor_day_range'
      and conrelid = 'public.recurring_definitions'::regclass
  ) then
    alter table public.recurring_definitions
      add constraint recurring_definitions_anchor_day_range
      check (anchor_day is null or (anchor_day between 1 and 31));
  end if;
end
$$;

comment on column public.recurring_definitions.anchor_day is
  'Intended day-of-month (1..31) for monthly rules; drives no-drift clamp in the '
  'recurrence date engine. Null for day/week rules. occurrence_slot stays the '
  'durable per-occurrence key.';
