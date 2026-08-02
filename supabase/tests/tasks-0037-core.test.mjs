/**
 * Bbettr OS — Migration 0037 (core tasks table) proof.
 *
 * Runs the REAL 0037_planner_tasks_core.sql (on top of the 0036 workspace
 * foundation) against a disposable local PostgreSQL and exhaustively verifies:
 *   - table/constraint/FK/trigger/index/RLS structure
 *   - every CHECK constraint (rejections)
 *   - every legal completion/archive state (accepted) + illegal ones (rejected)
 *   - the lightweight audit trigger (updated_at + immutable fields; no actor stamp)
 *   - the defensive subtask guard (one-level hierarchy + parent-completion block)
 *   - the composite self-FK (same-workspace parent only)
 *   - RLS (admin+workspace read; client/rep/anon zero; writes denied; service_role)
 *   - no deferred (0038–0047) objects; composition with the real 0027–0037 chain
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const WS1 = "00000000-0000-0000-0000-000000000001"; // agency workspace (0036 seed)
const WS2 = "00000000-0000-0000-0000-000000000002"; // second workspace (test-only)
const NOW = "2026-08-01T10:00:00Z"; // fixed timestamp for bound-param test data
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1",
  admin2: "00000000-0000-0000-0000-0000000000a2",
  admin3: "00000000-0000-0000-0000-0000000000a3", // admin in WS2
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
  none: "00000000-0000-0000-0000-0000000000f1",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url)))
    throw new Error("tasks-0037: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0037: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
insert into auth.users (id,email) values
  ('${U.admin1}','a1'),('${U.admin2}','a2'),('${U.admin3}','a3'),
  ('${U.client}','c1'),('${U.rep}','d1'),('${U.none}','f1');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.admin2}','admin','Ashwin'),('${U.admin3}','admin','WS2 Admin'),
  ('${U.client}','client','Client'),('${U.rep}','rep','Rep');
`;

const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
}
async function tryQuery(c, text, params = []) {
  try { const r = await c.query(text, params); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { return { rows: [], rowCount: 0, error: e }; }
}
async function scalar(c, text, params = []) {
  const { rows } = await c.query(text, params);
  return rows[0] ? Object.values(rows[0])[0] : undefined;
}
async function runAs(c, role, uid, sql, params = []) {
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`,
      [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]);
    const res = await c.query(sql, params);
    await c.query("rollback");
    return { rows: res.rows, rowCount: res.rowCount ?? 0, error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const denied = (r) => r.error !== null || r.rowCount === 0;

/** Insert a task as the superuser (bypasses RLS; triggers + CHECKs still run). */
async function insTask(c, cols = {}) {
  const base = { workspace_id: WS1, title: "t", created_by: U.admin1 };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  const vals = keys.map((_, i) => `$${i + 1}`);
  return tryQuery(c,
    `insert into public.tasks (${keys.join(",")}) values (${vals.join(",")}) returning id`,
    keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(sqlFile("0036_planner_workspaces.sql"));
  await c.query(sqlFile("0037_planner_tasks_core.sql"));
  // second workspace + an admin in it (WS2 not created by the 0036 seed)
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure ─────────────────────────────────────────────────────────────
  console.log("\n── Structure ──");
  check("tasks base table exists",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='tasks' and table_type='BASE TABLE'`)).rows.length === 1);
  check("unique (workspace_id,id) present",
    (await scalar(c, `select count(*)::int from pg_constraint where conname='tasks_workspace_id_unique' and contype='u'`)) === 1);
  const fkCount = await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.tasks'::regclass and contype='f'`);
  check("all 7 FKs present (workspace, created_by, owner, assignee, completed_by, client, parent)", fkCount === 7, `got ${fkCount}`);
  check("NO recurrence_definition_id FK yet (deferred to 0041)",
    (await scalar(c, `select count(*)::int from pg_constraint con join pg_attribute a
       on a.attrelid=con.conrelid and a.attnum = any(con.conkey)
       where con.conrelid='public.tasks'::regclass and con.contype='f' and a.attname='recurrence_definition_id'`)) === 0);
  check("audit trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='tasks_enforce_audit' and not tgisinternal`)) === 1);
  check("subtask guard trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='tasks_subtask_guard' and not tgisinternal`)) === 1);
  check("RLS enabled + forced",
    (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.tasks'::regclass`)) === true);
  check("all 7 core indexes present",
    (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexname in
      ('tasks_today_idx','tasks_due_idx','tasks_my_tasks_idx','tasks_inbox_idx','tasks_team_view_idx','tasks_client_idx','tasks_parent_idx')`)) === 7);

  // ── CHECK constraints (rejections) ────────────────────────────────────────
  console.log("\n── CHECK constraints (reject invalid) ──");
  check("empty title rejected", (await insTask(c, { title: "   " })).error !== null);
  check("bad status rejected", (await insTask(c, { status: "bogus" })).error !== null);
  check("bad priority rejected", (await insTask(c, { priority: "urgent" })).error !== null);
  check("estimated_minutes=0 rejected", (await insTask(c, { estimated_minutes: 0 })).error !== null);
  check("estimated_minutes<0 rejected", (await insTask(c, { estimated_minutes: -5 })).error !== null);
  check("planned WITHOUT owner rejected (owner_beyond_inbox)",
    (await insTask(c, { status: "planned" })).error !== null);
  check("in_progress WITHOUT assignee rejected",
    (await insTask(c, { status: "in_progress", owner_user_id: U.admin1 })).error !== null);
  check("critical WITHOUT reason rejected",
    (await insTask(c, { status: "planned", owner_user_id: U.admin1, priority: "critical" })).error !== null);
  check("non-critical WITH reason rejected (iff)",
    (await insTask(c, { priority: "normal", critical_reason: "x" })).error !== null);
  check("bad resume_target rejected",
    (await insTask(c, { status: "waiting", owner_user_id: U.admin1, blocked_since: NOW, resume_target: "bogus" })).error !== null);
  check("waiting WITHOUT blocked_since/resume_target rejected",
    (await insTask(c, { status: "waiting", owner_user_id: U.admin1 })).error !== null);
  check("occurrence: definition set, slot null rejected",
    (await insTask(c, { recurrence_definition_id: WS1, occurrence_slot: null })).error !== null);
  check("occurrence: slot set, definition null rejected",
    (await insTask(c, { occurrence_slot: "2026-08-01" })).error !== null);

  // parent_id = self rejected (CHECK parent_not_self)
  {
    const id = "00000000-0000-0000-0000-0000000000e1";
    const r = await tryQuery(c, `insert into public.tasks (id,workspace_id,title,created_by,parent_id)
      values ($1,$2,'self',$3,$1)`, [id, WS1, U.admin1]);
    check("parent_id = id rejected (parent_not_self)", r.error !== null);
  }

  // ── Completion / archive states ───────────────────────────────────────────
  console.log("\n── Completion / archive: legal accepted ──");
  check("active planned (owner set) accepted",
    (await insTask(c, { status: "planned", owner_user_id: U.admin1 })).error === null);
  check("completed (completed_at+by, archive null) accepted",
    (await insTask(c, { status: "completed", owner_user_id: U.admin1, completed_at: NOW, completed_by: U.admin1 })).error === null);
  check("archived+retention (completion RETAINED) accepted",
    (await insTask(c, { status: "archived", owner_user_id: U.admin1, completed_at: NOW, completed_by: U.admin1, archived_at: NOW, archive_reason: "retention" })).error === null);
  check("archived+cancelled (completion null) accepted",
    (await insTask(c, { status: "archived", owner_user_id: U.admin1, archived_at: NOW, archive_reason: "cancelled" })).error === null);

  console.log("\n── Completion / archive: illegal rejected ──");
  check("completed WITHOUT completed_at rejected",
    (await insTask(c, { status: "completed", owner_user_id: U.admin1, completed_by: U.admin1 })).error !== null);
  check("completed WITH archived_at rejected",
    (await insTask(c, { status: "completed", owner_user_id: U.admin1, completed_at: NOW, completed_by: U.admin1, archived_at: NOW })).error !== null);
  check("archived WITHOUT archive_reason rejected",
    (await insTask(c, { status: "archived", owner_user_id: U.admin1, archived_at: NOW })).error !== null);
  check("archived+retention WITHOUT completion rejected",
    (await insTask(c, { status: "archived", owner_user_id: U.admin1, archived_at: NOW, archive_reason: "retention" })).error !== null);
  check("archived+cancelled WITH completion rejected",
    (await insTask(c, { status: "archived", owner_user_id: U.admin1, completed_at: NOW, completed_by: U.admin1, archived_at: NOW, archive_reason: "cancelled" })).error !== null);
  check("active planned WITH completed_at rejected",
    (await insTask(c, { status: "planned", owner_user_id: U.admin1, completed_at: NOW, completed_by: U.admin1 })).error !== null);

  // ── Audit trigger ─────────────────────────────────────────────────────────
  console.log("\n── Audit trigger (mechanical only) ──");
  const at = (await insTask(c, { title: "audit" })).rows[0].id;
  check("created_at & updated_at stamped on insert",
    (await scalar(c, `select created_at is not null and updated_at is not null from public.tasks where id='${at}'`)) === true);
  await c.query(`select pg_sleep(0.01)`);
  await c.query(`update public.tasks set title='audit2' where id='${at}'`);
  check("updated_at advances on update",
    (await scalar(c, `select updated_at > created_at from public.tasks where id='${at}'`)) === true);
  // immutable fields held to OLD even if an update tries to change them
  await c.query(`update public.tasks set created_by='${U.admin2}', workspace_id='${WS2}', created_at=now() - interval '1 year' where id='${at}'`);
  check("created_by held immutable on update",
    (await scalar(c, `select created_by from public.tasks where id='${at}'`)) === U.admin1);
  check("workspace_id held immutable on update",
    (await scalar(c, `select workspace_id from public.tasks where id='${at}'`)) === WS1);
  // trigger never stamps actor from auth.uid(): insert created_by=admin1 while jwt=admin2
  await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U.admin2 })]);
  const noStamp = await insTask(c, { title: "nostamp", created_by: U.admin1 });
  await c.query(`select set_config('request.jwt.claims','{}',false)`);
  check("audit trigger does NOT stamp created_by from auth.uid()",
    (await scalar(c, `select created_by from public.tasks where id='${noStamp.rows[0].id}'`)) === U.admin1);

  // ── Subtask guard ─────────────────────────────────────────────────────────
  console.log("\n── Subtask guard (structural backstop) ──");
  const parent = (await insTask(c, { title: "P", status: "planned", owner_user_id: U.admin1 })).rows[0].id;
  const child = (await insTask(c, { title: "C", parent_id: parent, status: "planned", owner_user_id: U.admin1 })).rows[0].id;
  check("child under a parent accepted", child != null);
  check("grandchild rejected (one-level hierarchy)",
    (await insTask(c, { title: "G", parent_id: child })).error !== null);
  const other = (await insTask(c, { title: "O" })).rows[0].id;
  check("giving a task-with-children a parent rejected",
    (await tryQuery(c, `update public.tasks set parent_id='${other}' where id='${parent}'`)).error !== null);
  check("completing a parent with an ACTIVE child rejected (ActiveChildren)",
    (await tryQuery(c, `update public.tasks set status='completed', completed_at=now(), completed_by='${U.admin1}' where id='${parent}'`)).error !== null);
  await c.query(`update public.tasks set status='completed', completed_at=now(), completed_by='${U.admin1}' where id='${child}'`);
  check("completing a parent after children resolved accepted",
    (await tryQuery(c, `update public.tasks set status='completed', completed_at=now(), completed_by='${U.admin1}' where id='${parent}'`)).error === null);

  // ── Composite self-FK ─────────────────────────────────────────────────────
  console.log("\n── Composite self-FK (same-workspace parent) ──");
  const ws2task = (await insTask(c, { workspace_id: WS2, title: "ws2" })).rows[0].id;
  check("cross-workspace parent rejected (composite FK)",
    (await insTask(c, { workspace_id: WS1, title: "x", parent_id: ws2task })).error !== null);
  const sameWsParent = (await insTask(c, { workspace_id: WS1, title: "pw" })).rows[0].id;
  check("same-workspace parent accepted",
    (await insTask(c, { workspace_id: WS1, title: "cw", parent_id: sameWsParent })).error === null);
  check("nonexistent parent rejected (FK)",
    (await insTask(c, { parent_id: "00000000-0000-0000-0000-0000000000ee" })).error !== null);

  // ── RLS ───────────────────────────────────────────────────────────────────
  console.log("\n── RLS ──");
  const ws1Task = (await insTask(c, { workspace_id: WS1, title: "ws1-visible", owner_user_id: U.admin1, status: "planned" })).rows[0].id;
  const ws2Owned = (await insTask(c, { workspace_id: WS2, title: "ws2-only", owner_user_id: U.admin3, status: "planned" })).rows[0].id;
  const del = (await insTask(c, { workspace_id: WS1, title: "deleted" })).rows[0].id;
  await c.query(`update public.tasks set deleted_at=now() where id='${del}'`);

  check("admin1 sees WS1 task",
    (await runAs(c, "authenticated", U.admin1, `select 1 from public.tasks where id='${ws1Task}'`)).rowCount === 1);
  check("admin2 (same workspace) also sees WS1 task",
    (await runAs(c, "authenticated", U.admin2, `select 1 from public.tasks where id='${ws1Task}'`)).rowCount === 1);
  check("admin1 does NOT see WS2 task (workspace scoping)",
    (await runAs(c, "authenticated", U.admin1, `select 1 from public.tasks where id='${ws2Owned}'`)).rowCount === 0);
  check("admin3 sees their own WS2 task",
    (await runAs(c, "authenticated", U.admin3, `select 1 from public.tasks where id='${ws2Owned}'`)).rowCount === 1);
  check("admin3 does NOT see WS1 task; every visible row is WS2-scoped",
    (await runAs(c, "authenticated", U.admin3, `select 1 from public.tasks where id='${ws1Task}'`)).rowCount === 0 &&
    (await runAs(c, "authenticated", U.admin3, `select distinct workspace_id from public.tasks`)).rows.every((r) => r.workspace_id === WS2));
  check("soft-deleted task hidden from admin (deleted_at)",
    (await runAs(c, "authenticated", U.admin1, `select 1 from public.tasks where id='${del}'`)).rowCount === 0);
  check("client sees ZERO tasks", (await runAs(c, "authenticated", U.client, `select * from public.tasks`)).rowCount === 0);
  check("rep sees ZERO tasks", (await runAs(c, "authenticated", U.rep, `select * from public.tasks`)).rowCount === 0);
  check("anon sees ZERO tasks", denied(await runAs(c, "anon", null, `select * from public.tasks`)));
  check("authenticated-without-profile sees ZERO",
    (await runAs(c, "authenticated", U.none, `select * from public.tasks`)).rowCount === 0);
  check("admin cannot INSERT a task (write-lockdown)", denied(await runAs(c, "authenticated", U.admin1,
    `insert into public.tasks (workspace_id,title,created_by) values ('${WS1}','x','${U.admin1}')`)));
  check("admin cannot UPDATE a task", denied(await runAs(c, "authenticated", U.admin1,
    `update public.tasks set title='hax' where id='${ws1Task}'`)));
  check("admin cannot DELETE a task", denied(await runAs(c, "authenticated", U.admin1,
    `delete from public.tasks where id='${ws1Task}'`)));
  check("service_role can read all tasks",
    (await runAs(c, "service_role", null, `select 1 from public.tasks where id='${ws2Owned}'`)).rowCount === 1);

  // ── No deferred objects ───────────────────────────────────────────────────
  console.log("\n── No 0038–0047 objects ──");
  const absent = async (t) => (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rows.length === 0;
  check("no task_blockers/dependencies/labels/events/redactions/receipts/reminders",
    (await absent("task_blockers")) && (await absent("task_dependencies")) && (await absent("labels")) &&
    (await absent("task_labels")) && (await absent("task_events")) && (await absent("event_redactions")) &&
    (await absent("command_receipts")) && (await absent("task_reminders")) && (await absent("recurring_definitions")));
  check("no recurrence unique index (deferred to 0041)",
    (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexdef ilike '%recurrence_definition_id%occurrence_slot%'`)) === 0);

  // ── Composition with the real 0027–0037 chain ─────────────────────────────
  console.log("\n── Composition: real 0027–0037 chain ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  for (const f of ["0027_planner_tasks.sql","0028_calendar_credentials.sql","0029_meetings.sql","0030_meeting_attendees.sql",
    "0031_calendar_projections.sql","0032_meetings_idempotency.sql","0033_create_meeting_rpc.sql","0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql","0036_planner_workspaces.sql","0037_planner_tasks_core.sql"]) {
    const r = await tryQuery(c, sqlFile(f));
    if (r.error) { chainErr = `${f}: ${r.error.message}`; break; }
  }
  check("full 0027–0037 chain applies without collision", chainErr === null, chainErr ?? "");
  check("tasks (new shape, has workspace_id) present after chain",
    (await c.query(`select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='workspace_id'`)).rows.length === 1);
  check("meetings + workspaces intact",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='meetings'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='workspaces'`)).rows.length === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0037 CORE CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
