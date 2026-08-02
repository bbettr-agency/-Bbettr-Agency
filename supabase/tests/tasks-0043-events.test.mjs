/**
 * Bbettr OS — Migration 0043 (task_events) proof.
 *
 * Runs the REAL 0043_planner_task_events.sql (on top of 0036–0042) against a
 * disposable local PostgreSQL and exhaustively verifies: structure, append
 * validity + all CHECKs (incl. the 36-name vocabulary and actor consistency),
 * ordering/uniqueness (incl. the Waiting-completion event pair), absolute
 * append-only immutability (reject-mutation trigger for EVERY role), actor
 * deactivation via ON DELETE SET NULL, service-role-only RLS (admins never read
 * raw), the strict boundary, and chain composition.
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
  gone: "00000000-0000-0000-0000-0000000000e9", // profile that will be deleted
};
const TA = "00000000-0000-0000-0000-00000000a001"; // WS1 task
const TW = "00000000-0000-0000-0000-00000000b001"; // WS2 task

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0043: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0043: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
insert into auth.users (id,email) values ('${U.admin1}','a1'),('${U.admin3}','a3'),('${U.client}','c1'),('${U.rep}','d1'),('${U.none}','f1'),('${U.gone}','g');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.admin3}','admin','WS2 Admin'),('${U.client}','client','Client'),('${U.rep}','rep','Rep'),('${U.gone}','admin','Doomed');
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

let VSEQ = 0; // monotonic aggregate_version generator for tests
async function insEvent(c, cols = {}) {
  const base = {
    workspace_id: WS1, task_id: TA, aggregate_version: ++VSEQ, event_sequence: 1,
    event_type: "TaskCaptured", event_schema_version: 1, actor_kind: "user",
    actor_user_id: U.admin1, actor_display: "Eloff", occurred_at: NOW, payload: "{}",
  };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.task_events (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning event_id`, keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql","0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql","0042_planner_task_reminders.sql","0043_planner_task_events.sql"])
    await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
  await c.query(`update public.profiles set workspace_id='${WS1}' where id='${U.gone}'`);
  await c.query(`insert into public.tasks (id,workspace_id,title,created_by) values ('${TA}','${WS1}','A','${U.admin1}'),('${TW}','${WS2}','W','${U.admin1}')`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure ──────────────────────────────────────────────────────────────
  console.log("\n── Structure ──");
  check("task_events base table exists", (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_events' and table_type='BASE TABLE'`)).rows.length === 1);
  check("exact 17 columns (16 + global_seq)", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='task_events'`)) === 17);
  check("global_seq is bigserial-backed (has default nextval)", (await scalar(c, `select column_default like 'nextval%' from information_schema.columns where table_name='task_events' and column_name='global_seq'`)) === true);
  check("PK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_events'::regclass and contype='p'`)) === 1);
  check("composite task FK + actor FK present (2 FKs)", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_events'::regclass and contype='f'`)) === 2);
  check("actor FK is ON DELETE SET NULL", (await scalar(c, `select confdeltype from pg_constraint where conrelid='public.task_events'::regclass and contype='f' and pg_get_constraintdef(oid) ilike '%actor_user_id%'`)) === "n");
  check("unique (task_id, aggregate_version, event_sequence)", (await scalar(c, `select count(*)::int from pg_constraint where conname='task_events_task_version_seq_unique' and contype='u'`)) === 1);
  check("8 CHECK constraints present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_events'::regclass and contype='c'`)) === 8);
  check("reject-mutation trigger present (update+delete)", (await scalar(c, `select count(*)::int from pg_trigger where tgname='task_events_reject_mutation' and not tgisinternal`)) === 1);
  check("RLS enabled + forced, ZERO policies", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.task_events'::regclass`)) === true && (await scalar(c, `select count(*)::int from pg_policy where polrelid='public.task_events'::regclass`)) === 0);

  // ── Append validity / CHECKs ───────────────────────────────────────────────
  console.log("\n── Append validity / CHECKs ──");
  check("valid user event accepted", (await insEvent(c)).error === null);
  check("valid automation event accepted (actor_ref, no user id)", (await insEvent(c, { actor_kind: "automation", actor_user_id: null, actor_ref: "reactor:dep", actor_display: "Automation" })).error === null);
  check("valid system event accepted", (await insEvent(c, { actor_kind: "system", actor_user_id: null, actor_display: "System" })).error === null);
  check("unknown event_type rejected", (await insEvent(c, { event_type: "TaskFrobnicated" })).error !== null);
  check("future event_type (CommentAdded) rejected", (await insEvent(c, { event_type: "CommentAdded" })).error !== null);
  check("EventRedacted rejected (deferred to 0044)", (await insEvent(c, { event_type: "EventRedacted" })).error !== null);
  check("bad actor_kind rejected", (await insEvent(c, { actor_kind: "robot", actor_user_id: null })).error !== null);
  check("event_sequence < 1 rejected", (await insEvent(c, { event_sequence: 0 })).error !== null);
  check("aggregate_version < 1 rejected", (await insEvent(c, { aggregate_version: 0 })).error !== null);
  check("event_schema_version <= 0 rejected", (await insEvent(c, { event_schema_version: 0 })).error !== null);
  check("empty actor_display rejected", (await insEvent(c, { actor_display: "   " })).error !== null);
  check("non-user WITH actor_user_id rejected", (await insEvent(c, { actor_kind: "automation", actor_user_id: U.admin1, actor_display: "x" })).error !== null);
  check("user WITH actor_ref rejected", (await insEvent(c, { actor_kind: "user", actor_ref: "ref", actor_display: "x" })).error !== null);
  check("user with NULL actor_user_id accepted (e.g. post-deactivation shape)", (await insEvent(c, { actor_kind: "user", actor_user_id: null, actor_display: "Someone" })).error === null);

  // ── Ordering / uniqueness ──────────────────────────────────────────────────
  console.log("\n── Ordering / uniqueness ──");
  const v = ++VSEQ;
  check("two events same version, ordered sequences accepted (Waiting-completion pair)",
    (await insEvent(c, { aggregate_version: v, event_sequence: 1, event_type: "TaskUnblocked" })).error === null &&
    (await insEvent(c, { aggregate_version: v, event_sequence: 2, event_type: "TaskCompleted" })).error === null);
  check("duplicate (task, version, sequence) rejected", (await insEvent(c, { aggregate_version: v, event_sequence: 1, event_type: "TaskUnblocked" })).error !== null);
  check("cross-workspace task_id rejected", (await insEvent(c, { workspace_id: WS1, task_id: TW })).error !== null);
  check("nonexistent task rejected", (await insEvent(c, { task_id: "00000000-0000-0000-0000-0000000000ee" })).error !== null);

  // ── Absolute append-only immutability ──────────────────────────────────────
  console.log("\n── Append-only immutability ──");
  const ev = (await insEvent(c, { event_type: "TaskRenamed" })).rows[0].event_id;
  check("UPDATE rejected for superuser (reject trigger)", (await tryQuery(c, `update public.task_events set event_type='TaskArchived' where event_id='${ev}'`)).error !== null);
  check("DELETE rejected for superuser (reject trigger)", (await tryQuery(c, `delete from public.task_events where event_id='${ev}'`)).error !== null);
  check("UPDATE rejected for service_role", (await runAs(c, "service_role", null, `update public.task_events set payload='{}'::jsonb where event_id='${ev}'`)).error !== null);
  check("DELETE rejected for service_role", (await runAs(c, "service_role", null, `delete from public.task_events where event_id='${ev}'`)).error !== null);
  // The FK-SET-NULL permit is NARROW: nulling actor_user_id AND changing content is rejected.
  const evu = (await insEvent(c, { event_type: "TaskStarted", actor_kind: "user", actor_user_id: U.admin1, actor_display: "Eloff" })).rows[0].event_id;
  check("nulling actor_user_id is NOT a loophole (also changing payload rejected)",
    (await tryQuery(c, `update public.task_events set actor_user_id=null, payload='{"x":1}'::jsonb where event_id='${evu}'`)).error !== null);
  check("changing actor_user_id to another non-null value rejected",
    (await tryQuery(c, `update public.task_events set actor_user_id='${U.admin3}' where event_id='${evu}'`)).error !== null);

  // ── Actor deactivation (ON DELETE SET NULL) ────────────────────────────────
  console.log("\n── Actor deactivation ──");
  const de = (await insEvent(c, { actor_kind: "user", actor_user_id: U.gone, actor_display: "Doomed (snapshot)" })).rows[0].event_id;
  await c.query(`delete from public.profiles where id='${U.gone}'`); // cascades from auth in prod; here direct
  const after = (await c.query(`select actor_user_id, actor_kind, actor_display from public.task_events where event_id='${de}'`)).rows[0];
  check("deleting the referenced profile nulls actor_user_id (event survives)", after.actor_user_id === null && after.actor_kind === "user");
  check("actor_display snapshot intact after deactivation", after.actor_display === "Doomed (snapshot)");
  check("event row still present (not deleted) after actor removal", (await scalar(c, `select count(*)::int from public.task_events where event_id='${de}'`)) === 1);

  // ── RLS (service-role only; admins never read raw) ─────────────────────────
  console.log("\n── RLS ──");
  check("admin sees ZERO raw events", (await runAs(c, "authenticated", U.admin1, `select * from public.task_events`)).rowCount === 0);
  check("client sees ZERO", (await runAs(c, "authenticated", U.client, `select * from public.task_events`)).rowCount === 0);
  check("rep sees ZERO", (await runAs(c, "authenticated", U.rep, `select * from public.task_events`)).rowCount === 0);
  check("anon sees ZERO", denied(await runAs(c, "anon", null, `select * from public.task_events`)));
  check("admin cannot INSERT", denied(await runAs(c, "authenticated", U.admin1, `insert into public.task_events (workspace_id,task_id,aggregate_version,event_sequence,event_type,event_schema_version,actor_kind,actor_display,payload) values ('${WS1}','${TA}',999,1,'TaskCaptured',1,'user','x','{}')`)));
  check("service_role can INSERT", (await runAs(c, "service_role", null, `insert into public.task_events (workspace_id,task_id,aggregate_version,event_sequence,event_type,event_schema_version,actor_kind,actor_user_id,actor_display,payload) values ('${WS1}','${TA}',5000,1,'TaskCaptured',1,'user','${U.admin1}','Eloff','{}')`)).error === null);
  check("service_role can SELECT", (await runAs(c, "service_role", null, `select 1 from public.task_events limit 1`)).rowCount === 1);

  // ── Boundary ───────────────────────────────────────────────────────────────
  console.log("\n── Boundary ──");
  check("no non-internal trigger added to tasks (still 2)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal`)) === 2);
  check("only the reject-mutation trigger on task_events", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.task_events'::regclass and not tgisinternal`)) === 1);
  check("tasks.blocked_since untouched (no task-lifecycle change)", (await scalar(c, `select count(*)::int from public.tasks where blocked_since is not null`)) === 0);
  const absent = async (t) => (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rows.length === 0;
  check("no 0044–0047 objects (event_redactions/command_receipts)", (await absent("event_redactions")) && (await absent("command_receipts")));

  // ── Composition ────────────────────────────────────────────────────────────
  console.log("\n── Composition: real 0027–0043 chain ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  for (const f of ["0027_planner_tasks.sql","0028_calendar_credentials.sql","0029_meetings.sql","0030_meeting_attendees.sql",
    "0031_calendar_projections.sql","0032_meetings_idempotency.sql","0033_create_meeting_rpc.sql","0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql","0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql",
    "0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql","0042_planner_task_reminders.sql","0043_planner_task_events.sql"]) {
    const r = await tryQuery(c, sqlFile(f));
    if (r.error) { chainErr = `${f}: ${r.error.message}`; break; }
  }
  check("full 0027–0043 chain applies without collision", chainErr === null, chainErr ?? "");
  check("task_events + tasks + meetings present after chain",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_events'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='tasks'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='meetings'`)).rows.length === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0043 EVENTS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
