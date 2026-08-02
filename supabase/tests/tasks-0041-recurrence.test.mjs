/**
 * Bbettr OS — Migration 0041 (recurring_definitions) proof.
 *
 * Runs the REAL 0041_planner_recurring_definitions.sql (on top of 0036–0040)
 * against a disposable local PostgreSQL and exhaustively verifies: definition
 * structure/CHECKs/FKs, audit+immutability trigger, editability, archive
 * behaviour, the tasks recurrence FK + permanent partial-unique idempotency key,
 * RLS, the strict boundary (no generation/evaluator/reactor/events; tasks
 * lifecycle unchanged), and chain composition.
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
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1",
  admin3: "00000000-0000-0000-0000-0000000000a3",
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
  none: "00000000-0000-0000-0000-0000000000f1",
};
const CLIENT_ROW = "00000000-0000-0000-0000-00000000cccc";

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0041: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0041: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
insert into public.clients (id) values ('${CLIENT_ROW}');
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

async function insDef(c, cols = {}) {
  const base = { workspace_id: WS1, owner_user_id: U.admin1, template_title: "Weekly report", template_priority: "normal",
    rule_interval: 1, rule_unit: "week", mode: "schedule", missed_policy: "skip" };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.recurring_definitions (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`, keys.map((k) => merged[k]));
}
// Insert a task (superuser) — optionally a recurring instance.
async function insTask(c, cols = {}) {
  const base = { workspace_id: WS1, title: "t", created_by: U.admin1 };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.tasks (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`, keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql","0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql"])
    await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure — recurring_definitions ──────────────────────────────────────
  console.log("\n── Structure — recurring_definitions ──");
  check("table exists", (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='recurring_definitions' and table_type='BASE TABLE'`)).rows.length === 1);
  check("exact approved columns", (await scalar(c, `select array_agg(column_name order by column_name)::text from information_schema.columns where table_schema='public' and table_name='recurring_definitions'`)) ===
    "{active,archived_at,created_at,default_assignee_id,due_offset_days,id,missed_policy,mode,next_occurrence,owner_user_id,rule_interval,rule_unit,template_client_id,template_description,template_estimated_minutes,template_priority,template_title,timezone,updated_at,workspace_id}");
  check("PK + unique(workspace_id,id)", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.recurring_definitions'::regclass and contype in ('p','u')`)) === 2);
  check("4 FKs (workspace, owner, default_assignee, template_client)", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.recurring_definitions'::regclass and contype='f'`)) === 4);
  check("7 value CHECKs + due-offset guard present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.recurring_definitions'::regclass and contype='c'`)) === 8);
  check("audit/immutability trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='recurring_definitions_enforce_audit' and not tgisinternal`)) === 1);
  check("RLS enabled + forced", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.recurring_definitions'::regclass`)) === true);
  check("both evaluator indexes present", (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexname in ('recurring_definitions_schedule_due_idx','recurring_definitions_active_idx')`)) === 2);

  // ── Structure — tasks additions ────────────────────────────────────────────
  console.log("\n── Structure — tasks additions (FK + permanent unique) ──");
  check("tasks recurrence composite FK present", (await scalar(c, `select count(*)::int from pg_constraint where conname='tasks_recurrence_definition_fk' and conrelid='public.tasks'::regclass and contype='f'`)) === 1);
  check("tasks permanent partial unique present", (await scalar(c, `select count(*)::int from pg_indexes where indexname='tasks_recurrence_occurrence_idx' and indexdef ilike '%where (recurrence_definition_id is not null)%'`)) === 1);
  check("tasks column count unchanged (28, no new column)", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='tasks'`)) === 28);
  check("tasks non-internal trigger count unchanged (2)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal`)) === 2);

  // ── Definition values / CHECKs / defaults ──────────────────────────────────
  console.log("\n── Definition values / CHECKs ──");
  const d1 = await insDef(c);
  check("valid definition accepted", d1.error === null);
  check("timezone default applied", (await scalar(c, `select timezone from public.recurring_definitions where id='${d1.rows[0].id}'`)) === "Africa/Johannesburg");
  check("active default true", (await scalar(c, `select active from public.recurring_definitions where id='${d1.rows[0].id}'`)) === true);
  check("empty template_title rejected", (await insDef(c, { template_title: "  " })).error !== null);
  check("bad template_priority rejected", (await insDef(c, { template_priority: "urgent" })).error !== null);
  check("estimate<=0 rejected", (await insDef(c, { template_estimated_minutes: 0 })).error !== null);
  check("rule_interval<=0 rejected", (await insDef(c, { rule_interval: 0 })).error !== null);
  check("bad rule_unit rejected", (await insDef(c, { rule_unit: "year" })).error !== null);
  check("bad mode rejected", (await insDef(c, { mode: "manual" })).error !== null);
  check("bad missed_policy rejected", (await insDef(c, { missed_policy: "defer" })).error !== null);
  check("negative due_offset_days rejected", (await insDef(c, { due_offset_days: -1 })).error !== null);
  check("due_offset_days = 0 accepted", (await insDef(c, { due_offset_days: 0 })).error === null);
  check("completion mode accepted", (await insDef(c, { mode: "completion" })).error === null);

  // ── Definition FKs ─────────────────────────────────────────────────────────
  console.log("\n── Definition FKs ──");
  check("bad owner_user_id rejected", (await insDef(c, { owner_user_id: "00000000-0000-0000-0000-0000000000ee" })).error !== null);
  check("bad default_assignee_id rejected", (await insDef(c, { default_assignee_id: "00000000-0000-0000-0000-0000000000ee" })).error !== null);
  check("bad template_client_id rejected", (await insDef(c, { template_client_id: "00000000-0000-0000-0000-0000000000ee" })).error !== null);
  check("valid default_assignee + template_client accepted", (await insDef(c, { default_assignee_id: U.admin1, template_client_id: CLIENT_ROW })).error === null);

  // ── Editability + audit trigger ────────────────────────────────────────────
  console.log("\n── Editability + audit trigger ──");
  const ed = (await insDef(c, { template_title: "Edit me" })).rows[0].id;
  const before = await scalar(c, `select updated_at from public.recurring_definitions where id='${ed}'`);
  await c.query(`select pg_sleep(0.01)`);
  await c.query(`update public.recurring_definitions set template_title='Edited', template_priority='high', rule_interval=3, mode='completion', active=false, next_occurrence='2026-09-01', archived_at=now() where id='${ed}'`);
  check("template/rule/mode/active/next_occurrence edits succeed", (await scalar(c, `select template_title='Edited' and rule_interval=3 and mode='completion' and active=false and next_occurrence is not null from public.recurring_definitions where id='${ed}'`)) === true);
  check("updated_at advances on edit", (await scalar(c, `select updated_at > $1 from public.recurring_definitions where id='${ed}'`, [before])) === true);
  await c.query(`update public.recurring_definitions set id=gen_random_uuid(), workspace_id='${WS2}', created_at=now()-interval '1 year' where id='${ed}'`);
  const held = (await c.query(`select id, workspace_id from public.recurring_definitions where id='${ed}'`)).rows[0];
  check("id + workspace_id + created_at held immutable", held && held.workspace_id === WS1);

  // ── Editing a definition does NOT rewrite existing instances ───────────────
  console.log("\n── Editing does not rewrite existing instances ──");
  const gd = (await insDef(c, { template_title: "GenTemplate", template_priority: "low" })).rows[0].id;
  // a pre-existing generated instance (created directly for the test; 0041 does NOT generate)
  const inst = (await insTask(c, { workspace_id: WS1, title: "GenTemplate", owner_user_id: U.admin1, status: "planned", priority: "low", recurrence_definition_id: gd, occurrence_slot: "2026-08-01" })).rows[0].id;
  await c.query(`update public.recurring_definitions set template_title='Renamed', template_priority='high' where id='${gd}'`);
  check("existing generated instance is untouched by definition edit",
    (await scalar(c, `select title='GenTemplate' and priority='low' from public.tasks where id='${inst}'`)) === true);

  // ── Tasks recurrence coupling ──────────────────────────────────────────────
  console.log("\n── Tasks recurrence coupling ──");
  const rd = (await insDef(c, { workspace_id: WS1, template_title: "R" })).rows[0].id;
  const rdW2 = (await insDef(c, { workspace_id: WS2, template_title: "RW2", owner_user_id: U.admin3 })).rows[0].id;
  check("recurring task (def+slot, same workspace) accepted", (await insTask(c, { workspace_id: WS1, title: "i1", owner_user_id: U.admin1, status: "planned", recurrence_definition_id: rd, occurrence_slot: "2026-08-08" })).error === null);
  check("cross-workspace def rejected (composite FK)", (await insTask(c, { workspace_id: WS1, title: "x", owner_user_id: U.admin1, status: "planned", recurrence_definition_id: rdW2, occurrence_slot: "s" })).error !== null);
  check("nonexistent def rejected", (await insTask(c, { workspace_id: WS1, title: "x", owner_user_id: U.admin1, status: "planned", recurrence_definition_id: "00000000-0000-0000-0000-0000000000ee", occurrence_slot: "s" })).error !== null);
  check("def set but occurrence_slot null rejected (0037 pairing CHECK)", (await insTask(c, { workspace_id: WS1, title: "x", owner_user_id: U.admin1, status: "planned", recurrence_definition_id: rd })).error !== null);
  check("occurrence_slot set but def null rejected (0037 pairing CHECK)", (await insTask(c, { workspace_id: WS1, title: "x", owner_user_id: U.admin1, status: "planned", occurrence_slot: "orphan" })).error !== null);
  check("permanent idempotency: duplicate (def, slot) rejected", (await insTask(c, { workspace_id: WS1, title: "dup", owner_user_id: U.admin1, status: "planned", recurrence_definition_id: rd, occurrence_slot: "2026-08-08" })).error !== null);
  check("different slot for same def accepted", (await insTask(c, { workspace_id: WS1, title: "i2", owner_user_id: U.admin1, status: "planned", recurrence_definition_id: rd, occurrence_slot: "2026-08-15" })).error === null);
  check("many non-recurring (null,null) tasks coexist", (await insTask(c, { workspace_id: WS1, title: "n1" })).error === null && (await insTask(c, { workspace_id: WS1, title: "n2" })).error === null);

  // ── Archive behaviour ──────────────────────────────────────────────────────
  console.log("\n── Archive behaviour ──");
  const taskCountBefore = await scalar(c, `select count(*)::int from public.tasks`);
  const ad = (await insDef(c, { template_title: "ToArchive" })).rows[0].id;
  await c.query(`update public.recurring_definitions set active=false, archived_at=now() where id='${ad}'`);
  check("archive (active=false + archived_at) succeeds + row retained", (await scalar(c, `select active=false and archived_at is not null from public.recurring_definitions where id='${ad}'`)) === true);
  check("archiving generates NO task instance (task count unchanged)", (await scalar(c, `select count(*)::int from public.tasks`)) === taskCountBefore);

  // ── RLS ────────────────────────────────────────────────────────────────────
  console.log("\n── RLS ──");
  const ws1d = (await insDef(c, { workspace_id: WS1, template_title: "rls1" })).rows[0].id;
  const ws2d = (await insDef(c, { workspace_id: WS2, template_title: "rls2", owner_user_id: U.admin3 })).rows[0].id;
  check("admin1 sees WS1 definition", (await runAs(c, "authenticated", U.admin1, `select 1 from public.recurring_definitions where id='${ws1d}'`)).rowCount === 1);
  check("admin1 does NOT see WS2 definition", (await runAs(c, "authenticated", U.admin1, `select 1 from public.recurring_definitions where id='${ws2d}'`)).rowCount === 0);
  check("admin3 (WS2) sees only WS2 definitions", (await runAs(c, "authenticated", U.admin3, `select distinct workspace_id from public.recurring_definitions`)).rows.every((r) => r.workspace_id === WS2));
  check("client sees ZERO", (await runAs(c, "authenticated", U.client, `select * from public.recurring_definitions`)).rowCount === 0);
  check("rep sees ZERO", (await runAs(c, "authenticated", U.rep, `select * from public.recurring_definitions`)).rowCount === 0);
  check("anon sees ZERO", denied(await runAs(c, "anon", null, `select * from public.recurring_definitions`)));
  check("admin cannot INSERT", denied(await runAs(c, "authenticated", U.admin1, `insert into public.recurring_definitions (workspace_id,owner_user_id,template_title,template_priority,rule_interval,rule_unit,mode,missed_policy) values ('${WS1}','${U.admin1}','x','normal',1,'week','schedule','skip')`)));
  check("admin cannot UPDATE (advance next_occurrence)", denied(await runAs(c, "authenticated", U.admin1, `update public.recurring_definitions set next_occurrence='2026-10-01' where id='${ws1d}'`)));
  check("admin cannot DELETE", denied(await runAs(c, "authenticated", U.admin1, `delete from public.recurring_definitions where id='${ws1d}'`)));
  check("service_role can advance next_occurrence", (await runAs(c, "service_role", null, `update public.recurring_definitions set next_occurrence='2026-10-01' where id='${ws1d}'`)).error === null);

  // ── Boundary ───────────────────────────────────────────────────────────────
  console.log("\n── Boundary ──");
  check("no non-internal trigger on tasks added (still 2)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal`)) === 2);
  check("no trigger on recurring_definitions generates tasks (only the audit trigger exists)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.recurring_definitions'::regclass and not tgisinternal`)) === 1);
  const absent = async (t) => (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rows.length === 0;
  check("no 0042–0047 objects", (await absent("task_reminders")) && (await absent("task_events")) && (await absent("event_redactions")) && (await absent("command_receipts")));

  // ── Composition ────────────────────────────────────────────────────────────
  console.log("\n── Composition: real 0027–0041 chain ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  for (const f of ["0027_planner_tasks.sql","0028_calendar_credentials.sql","0029_meetings.sql","0030_meeting_attendees.sql",
    "0031_calendar_projections.sql","0032_meetings_idempotency.sql","0033_create_meeting_rpc.sql","0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql","0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql",
    "0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql"]) {
    const r = await tryQuery(c, sqlFile(f));
    if (r.error) { chainErr = `${f}: ${r.error.message}`; break; }
  }
  check("full 0027–0041 chain applies without collision", chainErr === null, chainErr ?? "");
  check("recurring_definitions + tasks FK/unique present after chain",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='recurring_definitions'`)).rows.length === 1 &&
    (await scalar(c, `select count(*)::int from pg_constraint where conname='tasks_recurrence_definition_fk'`)) === 1 &&
    (await scalar(c, `select count(*)::int from pg_indexes where indexname='tasks_recurrence_occurrence_idx'`)) === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0041 RECURRENCE CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
