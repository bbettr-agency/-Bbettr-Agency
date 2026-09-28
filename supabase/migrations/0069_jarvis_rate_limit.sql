-- ============================================================================
-- Bbettr OS — JARVIS INTELLIGENCE V1, Slice F2a (0069): shared transport
-- rate/cost guard.
--
-- Additive. Builds on Foundation 1 (0062/0063), Memory v1 (0064/0065), F1
-- privilege hardening (0066), the conversation substrate (0067) and transport
-- idempotency (0068). DATABASE PRIMITIVES ONLY — no route, no provider, no
-- Intelligence activation. Gives the authenticated F1d chat transport a genuinely
-- shared, atomic admission guard so a UI loop, a fresh-key retry storm, or a
-- compromised session cannot drive runaway paid provider requests.
--
--   public.jarvis_rate_counters — ONE row per (workspace_id, user_id) holding three
--     rolling fixed windows (minute / hour / UTC day). Updated in place (rollover
--     resets a window's count), so growth is O(users), not O(requests). OWNER data
--     is never read by the browser — service_role only. RLS ENABLE + FORCE, no
--     row policy: authenticated/anon get nothing.
--   public.jarvis_rate_check(...) — the single ATOMIC allow/deny decision. A
--     transaction-level advisory lock on (workspace,user) serializes all decisions
--     for that principal (incl. the first-ever request when no row exists), so the
--     limit can never be oversubscribed under real concurrency. Deny consumes NO
--     quota; allow increments all three windows exactly once. All time is DB time,
--     UTC-anchored; the caller supplies neither clock nor window. Limits are trusted
--     server constants passed by trusted server code — never HTTP input.
--
-- SECURITY: writes/reads service_role only; least-privilege ACLs set explicitly
-- (Supabase defaults revoked first). This migration does NOT enable Intelligence
-- and makes no provider/network call.
-- ============================================================================

-- ── One rolling-window counter row per principal (service_role only) ──────────
create table if not exists public.jarvis_rate_counters (
  workspace_id  uuid not null references public.workspaces (id),
  -- Owner. Privacy erasure: deleting the profile cascades the counter away.
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- Rolling fixed windows, each anchored to a UTC boundary (see the RPC). A count is
  -- meaningful only while its *_start matches the current window; on rollover the RPC
  -- resets the count and advances *_start in the same atomic decision.
  minute_start  timestamptz not null,
  minute_count  integer not null default 0 check (minute_count >= 0),
  hour_start    timestamptz not null,
  hour_count    integer not null default 0 check (hour_count >= 0),
  day_start     timestamptz not null,
  day_count     integer not null default 0 check (day_count >= 0),
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.jarvis_rate_counters enable row level security;
alter table public.jarvis_rate_counters force row level security;
-- Revoke Supabase defaults from ALL roles (incl. service_role) before granting the
-- least privilege the RPC needs. No authenticated/anon access whatsoever, and NO row
-- policy — normal sessions can never read another principal's counters (or their own).
revoke all on public.jarvis_rate_counters from anon, authenticated, service_role;
grant select, insert, update on public.jarvis_rate_counters to service_role; -- no DELETE: rollover overwrites; owner-cascade only

-- ── Atomic allow/deny decision ───────────────────────────────────────────────
-- Returns jsonb: { "allowed": true } OR { "allowed": false, "retry_after": <int seconds> }.
-- retry_after is the time until EVERY currently-exhausted window would permit another
-- request (the max reset among exhausted windows), floored at 1 second.
create or replace function public.jarvis_rate_check(
  p_workspace   uuid,
  p_user        uuid,
  p_per_minute  integer,
  p_per_hour    integer,
  p_per_day     integer
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now        timestamptz := clock_timestamp();
  -- UTC-anchored window starts: truncate in UTC then re-tag as timestamptz, so a
  -- boundary NEVER depends on the database session timezone.
  v_min_start  timestamptz := date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC';
  v_hour_start timestamptz := date_trunc('hour',   v_now at time zone 'UTC') at time zone 'UTC';
  v_day_start  timestamptz := date_trunc('day',    v_now at time zone 'UTC') at time zone 'UTC';
  r            public.jarvis_rate_counters%rowtype;
  v_min_count  integer := 0;
  v_hour_count integer := 0;
  v_day_count  integer := 0;
  v_denied     boolean := false;
  v_retry      integer := 0;
begin
  -- Limits are trusted server constants; reject a non-positive limit rather than
  -- silently admit or deny everything.
  if p_per_minute <= 0 or p_per_hour <= 0 or p_per_day <= 0 then
    raise exception 'jarvis_rate_check: limits must be positive';
  end if;

  -- Serialize ALL rate decisions for this (workspace,user) for the life of this
  -- transaction — including the first-ever request when no counter row exists yet.
  -- This is the sole concurrency arbiter; it removes any INSERT/SELECT-FOR-UPDATE
  -- ordering race and cannot deadlock (a single lock per principal, always taken
  -- before any table access).
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_user::text, 0));

  select * into r
    from public.jarvis_rate_counters
    where workspace_id = p_workspace and user_id = p_user;

  if found then
    -- A window's stored count applies only if its window has not rolled over.
    if r.minute_start = v_min_start then v_min_count := r.minute_count; end if;
    if r.hour_start   = v_hour_start then v_hour_count := r.hour_count; end if;
    if r.day_start    = v_day_start  then v_day_count := r.day_count;  end if;
  end if;

  -- Deny if ANY active window is already at/over its limit. Accumulate the LONGEST
  -- blocking reset so retry_after reflects when all exhausted windows permit a retry.
  if v_min_count >= p_per_minute then
    v_denied := true;
    v_retry := greatest(v_retry, ceil(extract(epoch from (v_min_start  + interval '1 minute' - v_now)))::int);
  end if;
  if v_hour_count >= p_per_hour then
    v_denied := true;
    v_retry := greatest(v_retry, ceil(extract(epoch from (v_hour_start + interval '1 hour'   - v_now)))::int);
  end if;
  if v_day_count >= p_per_day then
    v_denied := true;
    v_retry := greatest(v_retry, ceil(extract(epoch from (v_day_start  + interval '1 day'    - v_now)))::int);
  end if;

  if v_denied then
    -- Fail closed on the caller side; consume NO quota.
    return jsonb_build_object('allowed', false, 'retry_after', greatest(v_retry, 1));
  end if;

  -- Allowed: increment every window exactly once, resetting any that rolled over.
  insert into public.jarvis_rate_counters as c
    (workspace_id, user_id, minute_start, minute_count, hour_start, hour_count, day_start, day_count, updated_at)
  values (p_workspace, p_user, v_min_start, 1, v_hour_start, 1, v_day_start, 1, v_now)
  on conflict (workspace_id, user_id) do update set
    minute_start = v_min_start,
    minute_count = (case when c.minute_start = v_min_start then c.minute_count else 0 end) + 1,
    hour_start   = v_hour_start,
    hour_count   = (case when c.hour_start   = v_hour_start then c.hour_count   else 0 end) + 1,
    day_start    = v_day_start,
    day_count    = (case when c.day_start    = v_day_start  then c.day_count    else 0 end) + 1,
    updated_at   = v_now;

  return jsonb_build_object('allowed', true);
end;
$$;

-- ── Function EXECUTE ACL (Supabase grants EXECUTE by default; harden now) ─────
revoke all on function public.jarvis_rate_check(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.jarvis_rate_check(uuid, uuid, integer, integer, integer) to service_role;
