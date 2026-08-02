/**
 * Bbettr OS — Migration 0044 (event_redactions overlay) proof.
 *
 * Runs the REAL 0044_planner_event_redactions.sql (on top of 0036–0043) against
 * a disposable local PostgreSQL and exhaustively verifies: overlay structure +
 * all structural CHECKs, the same-workspace composite FK, the task_events
 * enablers (UNIQUE(workspace_id,event_id) + EventRedacted vocabulary), append-only
 * overlay immutability (reject-mutation trigger with the narrow redacted_by
 * SET-NULL permit), the redacted_by_display snapshot surviving deletion, that
 * ORIGINAL events are never touched, service-role-only RLS, boundary, and chain
 * composition.
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
  gone: "00000000-0000-0000-0000-0000000000e9",
};
const TA = "00000000-0000-0000-0000-00000000a001"; // WS1 task
const TW = "00000000-0000-0000-0000-00000000b001"; // WS2 task

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0044: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0044: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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

let VSEQ = 0;
async function insEvent(c, ws = WS1, task = TA) {
  return tryQuery(c, `insert into public.task_events (workspace_id,task_id,aggregate_version,event_sequence,event_type,event_schema_version,actor_kind,actor_user_id,actor_display,payload)
    values ($1,$2,$3,1,'TaskRenamed',1,'user',$4,'Eloff','{"before":"a","after":"b"}') returning event_id`, [ws, task, ++VSEQ, U.admin1]);
}
async function insRedaction(c, cols = {}) {
  const base = { workspace_id: WS1, redacted_fields: ["before"], mode: "suppress", reason: "PII", redacted_by: U.admin1, redacted_by_display: "Eloff" };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.event_redactions (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`, keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql","0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql","0042_planner_task_reminders.sql","0043_planner_task_events.sql","0044_planner_event_redactions.sql"])
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

  // ── task_events enablers ───────────────────────────────────────────────────
  console.log("\n── task_events enablers ──");
  check("UNIQUE (workspace_id, event_id) added to task_events", (await scalar(c, `select count(*)::int from pg_constraint where conname='task_events_workspace_event_unique' and contype='u'`)) === 1);
  check("event_type CHECK now accepts EventRedacted", (await tryQuery(c, `insert into public.task_events (workspace_id,task_id,aggregate_version,event_sequence,event_type,event_schema_version,actor_kind,actor_display,payload) values ('${WS1}','${TA}',9001,1,'EventRedacted',1,'system','sys','{}')`)).error === null);
  check("event_type CHECK still rejects unknown types", (await tryQuery(c, `insert into public.task_events (workspace_id,task_id,aggregate_version,event_sequence,event_type,event_schema_version,actor_kind,actor_display,payload) values ('${WS1}','${TA}',9002,1,'TaskFrobnicated',1,'system','sys','{}')`)).error !== null);
  check("task_events non-internal trigger count unchanged (1)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.task_events'::regclass and not tgisinternal`)) === 1);

  // ── Structure — event_redactions ───────────────────────────────────────────
  console.log("\n── Structure — event_redactions ──");
  check("table exists", (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='event_redactions' and table_type='BASE TABLE'`)).rows.length === 1);
  check("exact columns", (await scalar(c, `select array_agg(column_name order by column_name)::text from information_schema.columns where table_schema='public' and table_name='event_redactions'`)) ===
    "{created_at,id,mode,reason,redacted_by,redacted_by_display,redacted_fields,replacement,subject_kind,subject_ref,target_event_id,workspace_id}");
  check("PK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.event_redactions'::regclass and contype='p'`)) === 1);
  check("3 FKs (workspace, composite target, redacted_by)", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.event_redactions'::regclass and contype='f'`)) === 3);
  check("composite target FK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.event_redactions'::regclass and contype='f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id,%'`)) === 1);
  check("redacted_by FK is ON DELETE SET NULL", (await scalar(c, `select confdeltype from pg_constraint where conrelid='public.event_redactions'::regclass and contype='f' and pg_get_constraintdef(oid) ilike '%redacted_by%profiles%'`)) === "n");
  check("7 structural CHECKs present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.event_redactions'::regclass and contype='c'`)) === 7);
  check("reject-mutation trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='event_redactions_reject_mutation' and not tgisinternal`)) === 1);
  check("RLS enabled + forced, ZERO policies", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.event_redactions'::regclass`)) === true && (await scalar(c, `select count(*)::int from pg_policy where polrelid='public.event_redactions'::regclass`)) === 0);
  check("both lookup indexes present", (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexname in ('event_redactions_target_idx','event_redactions_subject_idx')`)) === 2);

  // ── Value CHECKs ───────────────────────────────────────────────────────────
  console.log("\n── Value CHECKs ──");
  const e1 = (await insEvent(c)).rows[0].event_id;
  check("valid per-event suppress redaction accepted", (await insRedaction(c, { target_event_id: e1 })).error === null);
  check("valid replace redaction (with replacement) accepted", (await insRedaction(c, { target_event_id: e1, mode: "replace", replacement: "***" })).error === null);
  check("bad mode rejected", (await insRedaction(c, { target_event_id: e1, mode: "delete" })).error !== null);
  check("replace WITHOUT replacement rejected", (await insRedaction(c, { target_event_id: e1, mode: "replace" })).error !== null);
  check("suppress WITH replacement rejected", (await insRedaction(c, { target_event_id: e1, mode: "suppress", replacement: "x" })).error !== null);
  check("empty reason rejected", (await insRedaction(c, { target_event_id: e1, reason: "  " })).error !== null);
  check("empty redacted_by_display rejected", (await insRedaction(c, { target_event_id: e1, redacted_by_display: " " })).error !== null);
  check("empty redacted_fields rejected", (await insRedaction(c, { target_event_id: e1, redacted_fields: [] })).error !== null);
  check("subject_kind WITHOUT subject_ref rejected", (await insRedaction(c, { target_event_id: null, subject_kind: "person" })).error !== null);
  check("addressing: neither target nor subject rejected", (await insRedaction(c, { target_event_id: null })).error !== null);
  check("subject-level redaction (no target) accepted", (await insRedaction(c, { target_event_id: null, subject_kind: "person", subject_ref: "p-42" })).error === null);

  // ── Same-workspace composite FK ────────────────────────────────────────────
  console.log("\n── Same-workspace composite FK ──");
  const ews2 = (await insEvent(c, WS2, TW)).rows[0].event_id;
  check("cross-workspace target event rejected", (await insRedaction(c, { workspace_id: WS1, target_event_id: ews2 })).error !== null);
  check("same-workspace WS2 target accepted", (await insRedaction(c, { workspace_id: WS2, target_event_id: ews2, redacted_by: U.admin3, redacted_by_display: "WS2 Admin" })).error === null);
  check("nonexistent target event rejected", (await insRedaction(c, { target_event_id: "00000000-0000-0000-0000-0000000000ee" })).error !== null);

  // ── Original events never touched ──────────────────────────────────────────
  console.log("\n── Original events never touched ──");
  const before = await scalar(c, `select payload::text from public.task_events where event_id='${e1}'`);
  await insRedaction(c, { target_event_id: e1, redacted_fields: ["before", "after"], mode: "replace", replacement: "REDACTED" });
  check("target event row is byte-identical after redaction", (await scalar(c, `select payload::text from public.task_events where event_id='${e1}'`)) === before);

  // ── Overlay immutability ───────────────────────────────────────────────────
  console.log("\n── Overlay immutability ──");
  const red = (await insRedaction(c, { target_event_id: e1, redacted_by: U.gone, redacted_by_display: "Doomed (snapshot)" })).rows[0].id;
  check("content UPDATE rejected (superuser)", (await tryQuery(c, `update public.event_redactions set reason='changed' where id='${red}'`)).error !== null);
  check("DELETE rejected (superuser)", (await tryQuery(c, `delete from public.event_redactions where id='${red}'`)).error !== null);
  check("UPDATE rejected (service_role)", (await runAs(c, "service_role", null, `update public.event_redactions set mode='replace' where id='${red}'`)).error !== null);
  check("changing redacted_by to another value rejected", (await tryQuery(c, `update public.event_redactions set redacted_by='${U.admin1}' where id='${red}'`)).error !== null);
  check("nulling redacted_by while changing another field rejected", (await tryQuery(c, `update public.event_redactions set redacted_by=null, reason='x' where id='${red}'`)).error !== null);
  // FK SET NULL permitted on profile deletion; snapshot survives
  await c.query(`delete from public.profiles where id='${U.gone}'`);
  const after = (await c.query(`select redacted_by, redacted_by_display from public.event_redactions where id='${red}'`)).rows[0];
  check("profile deletion nulls redacted_by (redaction survives)", after.redacted_by === null);
  check("redacted_by_display snapshot intact after deletion", after.redacted_by_display === "Doomed (snapshot)");

  // ── RLS (service-role only) ────────────────────────────────────────────────
  console.log("\n── RLS ──");
  check("admin sees ZERO redactions (safe read only)", (await runAs(c, "authenticated", U.admin1, `select * from public.event_redactions`)).rowCount === 0);
  check("client sees ZERO", (await runAs(c, "authenticated", U.client, `select * from public.event_redactions`)).rowCount === 0);
  check("rep sees ZERO", (await runAs(c, "authenticated", U.rep, `select * from public.event_redactions`)).rowCount === 0);
  check("anon sees ZERO", denied(await runAs(c, "anon", null, `select * from public.event_redactions`)));
  check("admin cannot INSERT", denied(await runAs(c, "authenticated", U.admin1, `insert into public.event_redactions (workspace_id,target_event_id,redacted_fields,mode,reason,redacted_by_display) values ('${WS1}','${e1}',array['before'],'suppress','x','Eloff')`)));
  check("service_role can INSERT", (await runAs(c, "service_role", null, `insert into public.event_redactions (workspace_id,target_event_id,redacted_fields,mode,reason,redacted_by,redacted_by_display) values ('${WS1}','${e1}',array['before'],'suppress','x','${U.admin1}','Eloff')`)).error === null);
  check("service_role can SELECT", (await runAs(c, "service_role", null, `select 1 from public.event_redactions limit 1`)).rowCount === 1);

  // ── Boundary ───────────────────────────────────────────────────────────────
  console.log("\n── Boundary ──");
  check("no non-internal trigger added to tasks (still 2)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal`)) === 2);
  check("tasks.blocked_since untouched", (await scalar(c, `select count(*)::int from public.tasks where blocked_since is not null`)) === 0);
  const absent = async (t) => (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rows.length === 0;
  check("no 0045–0047 objects (command_receipts)", await absent("command_receipts"));

  // ── Composition ────────────────────────────────────────────────────────────
  console.log("\n── Composition: real 0027–0044 chain ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  for (const f of ["0027_planner_tasks.sql","0028_calendar_credentials.sql","0029_meetings.sql","0030_meeting_attendees.sql",
    "0031_calendar_projections.sql","0032_meetings_idempotency.sql","0033_create_meeting_rpc.sql","0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql","0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql",
    "0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql","0042_planner_task_reminders.sql",
    "0043_planner_task_events.sql","0044_planner_event_redactions.sql"]) {
    const r = await tryQuery(c, sqlFile(f));
    if (r.error) { chainErr = `${f}: ${r.error.message}`; break; }
  }
  check("full 0027–0044 chain applies without collision", chainErr === null, chainErr ?? "");
  check("event_redactions + task_events + tasks present after chain",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='event_redactions'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_events'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='tasks'`)).rows.length === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0044 REDACTIONS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
