/**
 * Bbettr OS — Migration 0042 (task_reminders) proof.
 *
 * Runs the REAL 0042_planner_task_reminders.sql (on top of 0036–0041) against a
 * disposable local PostgreSQL and exhaustively verifies: structure, value/
 * lifecycle/claim CHECKs, same-workspace FK, dedupe + active-only uniqueness,
 * the engine state transitions, service-role-only RLS, the strict boundary
 * (no delivery/evaluator/events; no task-lifecycle change), and chain composition.
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const WS1 = "00000000-0000-0000-0000-000000000001";
const WS2 = "00000000-0000-0000-0000-000000000002";
const NOW = "2026-08-01T10:00:00Z";
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1",
  admin3: "00000000-0000-0000-0000-0000000000a3",
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
  none: "00000000-0000-0000-0000-0000000000f1",
};
const TA = "00000000-0000-0000-0000-00000000a001"; // WS1 task
const TW = "00000000-0000-0000-0000-00000000b001"; // WS2 task

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0042: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0042: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

const SCAFFOLD = `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub','')::uuid $fn$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then
  create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.clients (id uuid primary key default gen_random_uuid());
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text, email text, avatar_url text, created_at timestamptz not null default now());
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
grant select on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
insert into auth.users (id,email) values ('${U.admin1}','a1'),('${U.admin3}','a3'),('${U.client}','c1'),('${U.rep}','d1'),('${U.none}','f1');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.admin3}','admin','WS2 Admin'),('${U.client}','client','Client'),('${U.rep}','rep','Rep');
`;

const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");
let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function tryQuery(c, text, params = []) {
  try { const r = await c.query(text, params); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { return { rows: [], rowCount: 0, error: e }; }
}
async function scalar(c, text, params = []) { const { rows } = await c.query(text, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function runAs(c, role, uid, sql, params = []) {
  try {
    await c.query("begin"); await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]);
    const res = await c.query(sql, params); await c.query("rollback");
    return { rows: res.rows, rowCount: res.rowCount ?? 0, error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const denied = (r) => r.error !== null || r.rowCount === 0;

async function insRem(c, cols = {}) {
  const base = { workspace_id: WS1, task_id: TA, remind_at: NOW };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.task_reminders (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`, keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql","0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql","0042_planner_task_reminders.sql"])
    await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
  await c.query(`insert into public.tasks (id,workspace_id,title,created_by) values ('${TA}','${WS1}','A','${U.admin1}'),('${TW}','${WS2}','W','${U.admin1}')`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure ──────────────────────────────────────────────────────────────
  console.log("\n── Structure ──");
  check("task_reminders base table exists", (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_reminders' and table_type='BASE TABLE'`)).rows.length === 1);
  check("exact 12 columns", (await scalar(c, `select array_agg(column_name order by column_name)::text from information_schema.columns where table_schema='public' and table_name='task_reminders'`)) ===
    "{attempts,claim_token,claimed_at,created_at,dedupe_key,delivered_at,id,last_error,remind_at,state,task_id,workspace_id}");
  check("PK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_reminders'::regclass and contype='p'`)) === 1);
  check("composite (workspace_id,task_id) FK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_reminders'::regclass and contype='f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id,%'`)) === 1);
  check("5 CHECKs present (state, attempts, delivered, claim, last_error)", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_reminders'::regclass and contype='c'`)) === 5);
  check("dedupe partial unique present", (await scalar(c, `select count(*)::int from pg_indexes where indexname='task_reminders_dedupe_key_idx' and indexdef ilike '%where (dedupe_key is not null)%'`)) === 1);
  check("active-instant partial unique present", (await scalar(c, `select count(*)::int from pg_indexes where indexname='task_reminders_active_instant_idx' and indexdef ilike '%where (state = any%'`)) === 1);
  check("pending evaluator index present", (await scalar(c, `select count(*)::int from pg_indexes where indexname='task_reminders_pending_idx' and indexdef ilike '%where (state =%pending%'`)) === 1);
  check("RLS enabled + forced", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.task_reminders'::regclass`)) === true);
  check("NO RLS policies (service-role-only)", (await scalar(c, `select count(*)::int from pg_policy where polrelid='public.task_reminders'::regclass`)) === 0);
  check("state default pending / attempts default 0", (await scalar(c, `select (select column_default from information_schema.columns where table_name='task_reminders' and column_name='state') like '%pending%' and (select column_default from information_schema.columns where table_name='task_reminders' and column_name='attempts')='0'`)) === true);

  // ── Values / CHECKs ────────────────────────────────────────────────────────
  console.log("\n── Values / CHECKs ──");
  check("valid pending reminder accepted", (await insRem(c)).error === null);
  check("bad state rejected", (await insRem(c, { task_id: TA, remind_at: "2026-08-02T10:00:00Z", state: "queued" })).error !== null);
  check("attempts < 0 rejected", (await insRem(c, { remind_at: "2026-08-03T10:00:00Z", attempts: -1 })).error !== null);
  // delivered consistency
  check("delivered WITHOUT delivered_at rejected", (await insRem(c, { remind_at: "2026-08-04T10:00:00Z", state: "delivered" })).error !== null);
  check("non-delivered WITH delivered_at rejected", (await insRem(c, { remind_at: "2026-08-05T10:00:00Z", state: "pending", delivered_at: NOW })).error !== null);
  check("delivered + delivered_at accepted", (await insRem(c, { remind_at: "2026-08-06T10:00:00Z", state: "delivered", delivered_at: NOW })).error === null);
  check("cancelled with delivered_at null accepted", (await insRem(c, { remind_at: "2026-08-07T10:00:00Z", state: "cancelled" })).error === null);
  // claim pairing
  check("claimed_at WITHOUT claim_token rejected", (await insRem(c, { remind_at: "2026-08-08T10:00:00Z", claimed_at: NOW })).error !== null);
  check("claim_token WITHOUT claimed_at rejected", (await insRem(c, { remind_at: "2026-08-09T10:00:00Z", claim_token: "00000000-0000-0000-0000-0000000000cc" })).error !== null);
  check("both claim fields set accepted", (await insRem(c, { remind_at: "2026-08-10T10:00:00Z", state: "due", claimed_at: NOW, claim_token: "00000000-0000-0000-0000-0000000000cc" })).error === null);
  // last_error cap
  check("last_error > 200 chars rejected", (await insRem(c, { remind_at: "2026-08-11T10:00:00Z", last_error: "x".repeat(201) })).error !== null);
  check("last_error <= 200 chars accepted", (await insRem(c, { remind_at: "2026-08-12T10:00:00Z", last_error: "SMTP_TIMEOUT" })).error === null);

  // ── FK / same-workspace ────────────────────────────────────────────────────
  console.log("\n── FK / same-workspace ──");
  check("cross-workspace task rejected", (await insRem(c, { workspace_id: WS1, task_id: TW, remind_at: "2026-08-13T10:00:00Z" })).error !== null);
  check("same-workspace WS2 reminder accepted", (await insRem(c, { workspace_id: WS2, task_id: TW, remind_at: "2026-08-13T10:00:00Z" })).error === null);
  check("nonexistent task rejected", (await insRem(c, { task_id: "00000000-0000-0000-0000-0000000000ee", remind_at: "2026-08-14T10:00:00Z" })).error !== null);

  // ── Idempotency ────────────────────────────────────────────────────────────
  console.log("\n── Idempotency ──");
  await c.query(`delete from public.task_reminders`);
  check("first dedupe_key accepted", (await insRem(c, { remind_at: "2026-09-01T10:00:00Z", dedupe_key: "ext-1" })).error === null);
  check("duplicate dedupe_key in same workspace rejected", (await insRem(c, { remind_at: "2026-09-02T10:00:00Z", dedupe_key: "ext-1" })).error !== null);
  check("same dedupe_key in another workspace accepted", (await insRem(c, { workspace_id: WS2, task_id: TW, remind_at: "2026-09-03T10:00:00Z", dedupe_key: "ext-1" })).error === null);
  check("null dedupe_key rows coexist", (await insRem(c, { remind_at: "2026-09-04T10:00:00Z" })).error === null && (await insRem(c, { remind_at: "2026-09-05T10:00:00Z" })).error === null);
  // active-only (task_id, remind_at)
  await c.query(`delete from public.task_reminders`);
  const inst = "2026-10-01T10:00:00Z";
  const r1 = await insRem(c, { task_id: TA, remind_at: inst });
  check("first active reminder at instant accepted", r1.error === null);
  check("duplicate ACTIVE (task, instant) rejected", (await insRem(c, { task_id: TA, remind_at: inst })).error !== null);
  await c.query(`update public.task_reminders set state='cancelled' where id=$1`, [r1.rows[0].id]);
  check("re-create at same instant accepted after cancellation (active-only)", (await insRem(c, { task_id: TA, remind_at: inst })).error === null);

  // ── Engine state transitions (service_role writes) ─────────────────────────
  console.log("\n── Engine state transitions ──");
  await c.query(`delete from public.task_reminders`);
  const tr = (await insRem(c, { task_id: TA, remind_at: "2026-11-01T10:00:00Z" })).rows[0].id;
  check("pending -> due (claim set)", (await tryQuery(c, `update public.task_reminders set state='due', claimed_at=now(), claim_token=gen_random_uuid() where id=$1`, [tr])).error === null);
  check("due -> delivered (delivered_at set, claim released)", (await tryQuery(c, `update public.task_reminders set state='delivered', delivered_at=now(), claimed_at=null, claim_token=null where id=$1`, [tr])).error === null);
  const tr2 = (await insRem(c, { task_id: TA, remind_at: "2026-11-02T10:00:00Z" })).rows[0].id;
  check("retry bookkeeping (attempts++/last_error) valid", (await tryQuery(c, `update public.task_reminders set state='due', attempts=attempts+1, last_error='RETRYABLE' where id=$1`, [tr2])).error === null);
  check("cancel valid", (await tryQuery(c, `update public.task_reminders set state='cancelled' where id=$1`, [tr2])).error === null);

  // ── RLS (service-role-only) ────────────────────────────────────────────────
  console.log("\n── RLS (service-role-only) ──");
  const rid = (await insRem(c, { task_id: TA, remind_at: "2026-12-01T10:00:00Z" })).rows[0].id;
  check("admin sees ZERO (engine table)", (await runAs(c, "authenticated", U.admin1, `select * from public.task_reminders`)).rowCount === 0);
  check("client sees ZERO", (await runAs(c, "authenticated", U.client, `select * from public.task_reminders`)).rowCount === 0);
  check("rep sees ZERO", (await runAs(c, "authenticated", U.rep, `select * from public.task_reminders`)).rowCount === 0);
  check("anon sees ZERO", denied(await runAs(c, "anon", null, `select * from public.task_reminders`)));
  check("admin cannot INSERT", denied(await runAs(c, "authenticated", U.admin1, `insert into public.task_reminders (workspace_id,task_id,remind_at) values ('${WS1}','${TA}','2027-01-01T10:00:00Z')`)));
  check("admin cannot UPDATE", denied(await runAs(c, "authenticated", U.admin1, `update public.task_reminders set state='cancelled' where id='${rid}'`)));
  check("admin cannot DELETE", denied(await runAs(c, "authenticated", U.admin1, `delete from public.task_reminders where id='${rid}'`)));
  check("service_role can read", (await runAs(c, "service_role", null, `select 1 from public.task_reminders where id='${rid}'`)).rowCount === 1);
  check("service_role can insert", (await runAs(c, "service_role", null, `insert into public.task_reminders (workspace_id,task_id,remind_at) values ('${WS1}','${TA}','2027-02-01T10:00:00Z')`)).error === null);

  // ── Boundary ───────────────────────────────────────────────────────────────
  console.log("\n── Boundary ──");
  check("no non-internal trigger on task_reminders (pure engine table)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.task_reminders'::regclass and not tgisinternal`)) === 0);
  check("no non-internal trigger added to tasks (still 2)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal`)) === 2);
  check("tasks.blocked_since untouched (no task-lifecycle change)", (await scalar(c, `select count(*)::int from public.tasks where blocked_since is not null`)) === 0);
  const absent = async (t) => (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rows.length === 0;
  check("no ReminderDue events / no task_events", await absent("task_events"));
  check("no 0043–0047 objects", (await absent("task_events")) && (await absent("event_redactions")) && (await absent("command_receipts")));

  // ── Composition ────────────────────────────────────────────────────────────
  console.log("\n── Composition: real 0027–0042 chain ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  for (const f of ["0027_planner_tasks.sql","0028_calendar_credentials.sql","0029_meetings.sql","0030_meeting_attendees.sql",
    "0031_calendar_projections.sql","0032_meetings_idempotency.sql","0033_create_meeting_rpc.sql","0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql","0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql",
    "0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql","0042_planner_task_reminders.sql"]) {
    const r = await tryQuery(c, sqlFile(f));
    if (r.error) { chainErr = `${f}: ${r.error.message}`; break; }
  }
  check("full 0027–0042 chain applies without collision", chainErr === null, chainErr ?? "");
  check("task_reminders + tasks + meetings present after chain",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_reminders'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='tasks'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='meetings'`)).rows.length === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0042 REMINDERS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
