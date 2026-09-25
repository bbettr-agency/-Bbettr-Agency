-- ============================================================================
-- Bbettr OS — JARVIS FOUNDATION 1 privilege hardening (0066).
--
-- ADDITIVE, safe to run AFTER production 0065. Does NOT edit 0062/0063 (immutable,
-- already applied). RLS / policies / capability / approval / append-only semantics
-- are unchanged — this is least-privilege ACL hardening only (defense-in-depth:
-- least-privilege table grants AND RLS). No new browser write path; no widening of
-- Jarvis authority; no capability-registry or approval-rule change.
--
-- ROOT CAUSE (identical to the Memory issue closed by 0065, proven on a disposable
-- DB that reproduces Supabase defaults): Supabase runs, as the migration owner,
--   alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
-- so every new table auto-receives ALL for anon/authenticated. In 0062,
-- jarvis_capability_grants and jarvis_proposals did `grant select to authenticated`
-- WITHOUT first revoking those defaults, so anon/authenticated retained ALL.
-- (jarvis_action_events already revoked its defaults in 0062 and is correct — it is
-- intentionally NOT touched here.)
--
-- 0066 revokes the leftover privileges explicitly and re-affirms the intended
-- least-privilege end state. Idempotent.
-- ============================================================================

-- jarvis_capability_grants: anon NONE; authenticated SELECT only; service_role
-- trusted (grant management runs via the service role).
revoke all on public.jarvis_capability_grants from anon, authenticated;
grant select on public.jarvis_capability_grants to authenticated;
grant all    on public.jarvis_capability_grants to service_role;

-- jarvis_proposals: anon NONE; authenticated SELECT only; service_role trusted
-- (propose / approve / reject / execute run via the service role).
revoke all on public.jarvis_proposals from anon, authenticated;
grant select on public.jarvis_proposals to authenticated;
grant all    on public.jarvis_proposals to service_role;

-- NOTE: jarvis_action_events is intentionally left as-is — 0062 already revoked
-- anon/authenticated and set service_role to INSERT+SELECT (append-only), which is
-- the correct least-privilege state. jarvis_action_events_reject_mutation() is a
-- TRIGGER function (no caller EXECUTE required); its ACL is not security-relevant.
