-- ============================================================================
-- Bbettr OS — JARVIS MEMORY V1 privilege hardening (0065).
--
-- ADDITIVE, safe to run AFTER production 0064. Does NOT edit 0064 (immutable,
-- already applied). RLS/policies/logic are unchanged — this is least-privilege
-- ACL hardening (defense-in-depth: least-privilege table/function grants AND RLS).
--
-- ROOT CAUSE (proven on a disposable DB that reproduces Supabase defaults):
--   Supabase runs, as the migration owner:
--     alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
--     alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
--   so EVERY new table gets ALL for anon/authenticated and EVERY new function gets
--   EXECUTE for anon/authenticated — granted DIRECTLY (not via PUBLIC).
--   0064 added the intended GRANTs but, for jarvis_memories/jarvis_memory_conflicts,
--   did not first REVOKE those defaults; and for the mutation RPCs it revoked only
--   FROM PUBLIC. Hence anon/authenticated retained ALL on those two tables and
--   EXECUTE on the five mutation RPCs. (jarvis_memory_events was already correct —
--   0064 revoked from anon/authenticated there.)
--
-- 0065 revokes the leftover privileges explicitly and re-affirms the intended
-- least-privilege end state. Idempotent.
-- ============================================================================

-- ── Tables ──────────────────────────────────────────────────────────────────
-- anon: NONE. authenticated: SELECT only. service_role: trusted (memories/
-- conflicts full; events append-only INSERT+SELECT).
revoke all on public.jarvis_memories         from anon, authenticated;
revoke all on public.jarvis_memory_conflicts from anon, authenticated;
revoke all on public.jarvis_memory_events    from anon, authenticated;

grant select on public.jarvis_memories         to authenticated;
grant select on public.jarvis_memory_conflicts to authenticated;
grant select on public.jarvis_memory_events    to authenticated;

grant all on public.jarvis_memories         to service_role;
grant all on public.jarvis_memory_conflicts to service_role;
revoke all on public.jarvis_memory_events from service_role;
grant insert, select on public.jarvis_memory_events to service_role;

-- ── Mutation RPCs ────────────────────────────────────────────────────────────
-- anon/authenticated/PUBLIC: NO EXECUTE. service_role: EXECUTE. (The server
-- boundary calls these as service_role AFTER the F1 capability/authority checks;
-- no browser role may invoke them directly.)
revoke all on function public.jarvis_memory_create(uuid,jsonb,uuid,text,text)            from public, anon, authenticated;
revoke all on function public.jarvis_memory_confirm(uuid,uuid,text,uuid,text)            from public, anon, authenticated;
revoke all on function public.jarvis_memory_retire(uuid,uuid,text,text,uuid,text)        from public, anon, authenticated;
revoke all on function public.jarvis_memory_flag_conflict(uuid,uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.jarvis_memory_supersede(uuid,uuid,jsonb,uuid,text,text)    from public, anon, authenticated;

grant execute on function public.jarvis_memory_create(uuid,jsonb,uuid,text,text)            to service_role;
grant execute on function public.jarvis_memory_confirm(uuid,uuid,text,uuid,text)            to service_role;
grant execute on function public.jarvis_memory_retire(uuid,uuid,text,text,uuid,text)        to service_role;
grant execute on function public.jarvis_memory_flag_conflict(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.jarvis_memory_supersede(uuid,uuid,jsonb,uuid,text,text)    to service_role;

-- ── Read helpers (intended model — NOT mutation RPCs) ────────────────────────
-- jarvis_is_internal(), jarvis_can_read_memory(), jarvis_can_read_memory_row(uuid)
-- are evaluated INSIDE the RLS SELECT policies, so `authenticated` MUST retain
-- EXECUTE or legitimate reads fail with "permission denied for function" (proven).
-- They are fail-closed booleans (return false for non-internal / anon). Keep
-- EXECUTE for authenticated + service_role; drop PUBLIC and anon (never needed —
-- anon has no table access, so these policies never evaluate for anon).
revoke all on function public.jarvis_is_internal()             from public, anon;
revoke all on function public.jarvis_can_read_memory()         from public, anon;
revoke all on function public.jarvis_can_read_memory_row(uuid) from public, anon;

grant execute on function public.jarvis_is_internal()             to authenticated, service_role;
grant execute on function public.jarvis_can_read_memory()         to authenticated, service_role;
grant execute on function public.jarvis_can_read_memory_row(uuid) to authenticated, service_role;

-- NOTE: jarvis_memory_events_reject_mutation() is a TRIGGER function invoked by
-- the trigger mechanism (no caller EXECUTE is required); its ACL is not security-
-- relevant and is intentionally left as created.
