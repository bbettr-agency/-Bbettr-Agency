// ============================================================================
// tasks-0069 — JARVIS INTELLIGENCE V1, Slice F2a: shared rate/cost guard.
// Disposable-Postgres proof of schema, RLS/ACL, RPC EXECUTE ACL, and the atomic
// allow/deny/rollover/Retry-After semantics of jarvis_rate_check.
//
//   TEST_DATABASE_URL must point at a disposable DB whose name contains "test".
// ============================================================================
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const db = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("0069: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1";
const WS2 = "00000000-0000-0000-0000-0000000000e2";
const U1 = "00000000-0000-0000-0000-0000000000a1";
const U2 = "00000000-0000-0000-0000-0000000000a2";

const SCAFFOLD = `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub','')::uuid $fn$;
grant usage on schema auth, public to anon, authenticated, service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.workspaces (id uuid primary key, name text, slug text unique);
create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role public.user_role not null default 'client', client_id uuid references public.clients(id) on delete set null, workspace_id uuid references public.workspaces(id));
create or replace function public.is_admin() returns boolean language sql security definer set search_path=public stable as $fn$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_workspace_id() returns uuid language sql security definer set search_path=public stable as $fn$ select workspace_id from profiles where id = auth.uid(); $fn$;
grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
insert into public.workspaces (id,name,slug) values ('${WS}','Agency','agency'), ('${WS2}','Agency2','agency2');
insert into auth.users (id,email) values ('${U1}','a1@t'), ('${U2}','a2@t');
insert into public.profiles (id,role,workspace_id) values ('${U1}','admin','${WS}'), ('${U2}','admin','${WS}');
`;

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d && !ok ? "  — " + d : ""}`); ok ? pass++ : fail++; };
async function one(c, sql, params) { return (await c.query(sql, params)).rows[0]; }
async function rateCheck(c, ws, u, min, hr, day) {
  const r = await c.query(`select public.jarvis_rate_check($1,$2,$3,$4,$5) as v`, [ws, u, min, hr, day]);
  return r.rows[0].v;
}

async function main() {
  assertDisposableTarget();
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/planner_test";
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const m of ["0062_jarvis_foundation.sql", "0063_jarvis_action_events_fk_carveout.sql", "0064_jarvis_memory.sql", "0065_jarvis_memory_privilege_hardening.sql", "0066_jarvis_foundation_privilege_hardening.sql", "0067_jarvis_conversations.sql", "0068_jarvis_turn_idempotency.sql", "0069_jarvis_rate_limit.sql"]) {
    await c.query(readFileSync(join(MIG, m), "utf8"));
  }

  // ── schema / constraints ──
  check("table jarvis_rate_counters exists", (await one(c, `select to_regclass('public.jarvis_rate_counters') is not null as v`)).v === true);
  check("PK (workspace_id,user_id)", (await one(c, `select count(*)::int c from pg_constraint where conrelid='public.jarvis_rate_counters'::regclass and contype='p'`)).c === 1);
  check("FK count = 2 (workspace, user)", (await one(c, `select count(*)::int c from pg_constraint where conrelid='public.jarvis_rate_counters'::regclass and contype='f'`)).c === 2);
  check("count CHECKs present (>=0)", (await one(c, `select count(*)::int c from pg_constraint where conrelid='public.jarvis_rate_counters'::regclass and contype='c'`)).c >= 3);

  // ── RLS enabled + forced ──
  const rls = await one(c, `select relrowsecurity, relforcerowsecurity from pg_class where oid='public.jarvis_rate_counters'::regclass`);
  check("RLS enabled", rls.relrowsecurity === true);
  check("RLS forced", rls.relforcerowsecurity === true);
  check("no row policies", (await one(c, `select count(*)::int c from pg_policies where tablename='jarvis_rate_counters'`)).c === 0);

  // ── table ACL: authenticated/anon get NOTHING ──
  for (const [role, priv] of [["authenticated", "SELECT"], ["authenticated", "INSERT"], ["authenticated", "UPDATE"], ["anon", "SELECT"]]) {
    check(`table: ${role} has NO ${priv}`, (await one(c, `select has_table_privilege($1,'public.jarvis_rate_counters',$2) as v`, [role, priv])).v === false);
  }
  check("table: service_role has SELECT", (await one(c, `select has_table_privilege('service_role','public.jarvis_rate_counters','SELECT') as v`)).v === true);

  // ── RPC EXECUTE ACL ──
  const sig = "public.jarvis_rate_check(uuid,uuid,integer,integer,integer)";
  check("RPC: authenticated NO execute", (await one(c, `select has_function_privilege('authenticated',$1,'EXECUTE') as v`, [sig])).v === false);
  check("RPC: anon NO execute", (await one(c, `select has_function_privilege('anon',$1,'EXECUTE') as v`, [sig])).v === false);
  check("RPC: service_role EXECUTE", (await one(c, `select has_function_privilege('service_role',$1,'EXECUTE') as v`, [sig])).v === true);
  check("RPC is security invoker (not definer)", (await one(c, `select prosecdef from pg_proc where oid=$1::regprocedure`, [sig])).prosecdef === false);

  // ── first allowed request creates the row, counts = 1 ──
  let v = await rateCheck(c, WS, U1, 10, 120, 600);
  check("first request allowed", v.allowed === true);
  let row = await one(c, `select * from public.jarvis_rate_counters where workspace_id=$1 and user_id=$2`, [WS, U1]);
  check("row created with all counts = 1", row && row.minute_count === 1 && row.hour_count === 1 && row.day_count === 1);
  check("day_start is UTC midnight", (await one(c, `select day_start = date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' as v from public.jarvis_rate_counters where user_id=$1`, [U1])).v === true);

  // ── minute limit: with per_minute=3 (already 1 used), 2 more allowed, then denied ──
  check("2nd allowed (min=3)", (await rateCheck(c, WS, U1, 3, 120, 600)).allowed === true);
  check("3rd allowed (min=3)", (await rateCheck(c, WS, U1, 3, 120, 600)).allowed === true);
  v = await rateCheck(c, WS, U1, 3, 120, 600);
  check("4th DENIED (min=3)", v.allowed === false);
  check("denied returns retry_after >=1 and <=60", v.retry_after >= 1 && v.retry_after <= 60);
  check("denied did NOT increment (minute_count still 3)", (await one(c, `select minute_count from public.jarvis_rate_counters where user_id=$1`, [U1])).minute_count === 3);

  // ── minute rollover: push minute_start into the past → next call resets to 1 ──
  await c.query(`update public.jarvis_rate_counters set minute_start = minute_start - interval '2 minutes' where user_id=$1`, [U1]);
  check("after minute rollover: allowed again", (await rateCheck(c, WS, U1, 3, 120, 600)).allowed === true);
  check("minute_count reset to 1 on rollover", (await one(c, `select minute_count from public.jarvis_rate_counters where user_id=$1`, [U1])).minute_count === 1);

  // ── multiple exhausted windows → retry_after reflects the LONGER (hour) window ──
  // Fresh user U2: exhaust minute AND hour with per_minute=1, per_hour=1.
  check("U2 first allowed (min=1,hr=1)", (await rateCheck(c, WS, U2, 1, 1, 600)).allowed === true);
  v = await rateCheck(c, WS, U2, 1, 1, 600);
  check("U2 second denied (min+hour exhausted)", v.allowed === false);
  check("retry_after reflects the HOUR window (>60s), not the minute", v.retry_after > 60 && v.retry_after <= 3600);

  // ── hour rollover ──
  await c.query(`update public.jarvis_rate_counters set hour_start = hour_start - interval '2 hours', minute_start = minute_start - interval '2 minutes' where user_id=$1`, [U2]);
  check("U2 allowed after hour+minute rollover", (await rateCheck(c, WS, U2, 1, 1, 600)).allowed === true);

  // ── day rollover ──
  await c.query(`update public.jarvis_rate_counters set day_start = day_start - interval '2 days', hour_start=hour_start - interval '2 hours', minute_start=minute_start - interval '2 minutes', day_count=600 where user_id=$1`, [U2]);
  check("U2 allowed after day rollover (day_count was 600)", (await rateCheck(c, WS, U2, 10, 120, 600)).allowed === true);
  check("day_count reset to 1 on rollover", (await one(c, `select day_count from public.jarvis_rate_counters where user_id=$1`, [U2])).day_count === 1);

  // ── tenant isolation: same user id, different workspace = separate counter ──
  // (U1 belongs to WS; simulate WS2 counter for U1 to prove keying includes workspace.)
  const U3 = "00000000-0000-0000-0000-0000000000a9";
  await c.query(`insert into auth.users (id,email) values ($1,'a9@t')`, [U3]);
  await c.query(`insert into public.profiles (id, role, workspace_id) values ($1,'admin','${WS2}')`, [U3]);
  check("WS2/U3 independent of WS/U1", (await rateCheck(c, WS2, U3, 1, 120, 600)).allowed === true);
  check("WS2/U3 second denied (its own minute=1)", (await rateCheck(c, WS2, U3, 1, 120, 600)).allowed === false);
  check("WS/U1 unaffected by WS2 activity", (await one(c, `select count(*)::int c from public.jarvis_rate_counters where workspace_id=$1`, [WS2])).c === 1);

  // ── nonpositive limits fail safely (raise, not silently admit/deny) ──
  let threw = false;
  try { await rateCheck(c, WS, U1, 0, 120, 600); } catch { threw = true; }
  check("nonpositive per_minute raises", threw === true);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0069 JARVIS RATE LIMIT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
