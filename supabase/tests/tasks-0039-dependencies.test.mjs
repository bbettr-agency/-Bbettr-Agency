/**
 * Bbettr OS — Migration 0039 (task_dependencies) proof.
 *
 * Runs the REAL 0039_planner_task_dependencies.sql (on top of 0036/0037/0038)
 * against a disposable local PostgreSQL and exhaustively verifies: structure,
 * dependency-state consistency, values/FKs, active-only uniqueness + history,
 * silent-hold immutability, the defensive cycle guard (incl. reactivation and
 * malformed-graph termination), the strict boundary (no blocker/task changes),
 * RLS, and chain composition.
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
// WS1 tasks A..E; WS2 tasks W1,W2
const T = {
  A: "00000000-0000-0000-0000-00000000a001", B: "00000000-0000-0000-0000-00000000a002",
  C: "00000000-0000-0000-0000-00000000a003", D: "00000000-0000-0000-0000-00000000a004",
  E: "00000000-0000-0000-0000-00000000a005", W1: "00000000-0000-0000-0000-00000000b001",
  W2: "00000000-0000-0000-0000-00000000b002",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0039: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0039: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
  ('${U.admin1}','admin','Eloff'),('${U.admin3}','admin','WS2 Admin'),
  ('${U.client}','client','Client'),('${U.rep}','rep','Rep');
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
const reset = (c) => c.query(`delete from public.task_dependencies`);

async function insDep(c, cols = {}) {
  const base = { workspace_id: WS1, kind: "hard" };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.task_dependencies (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql", "0037_planner_tasks_core.sql", "0038_planner_task_blockers.sql", "0039_planner_task_dependencies.sql"])
    await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
  for (const [k, id] of Object.entries(T)) {
    const ws = k.startsWith("W") ? WS2 : WS1;
    await c.query(`insert into public.tasks (id,workspace_id,title,created_by) values ($1,$2,$3,$4)`, [id, ws, k, U.admin1]);
  }
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure ──────────────────────────────────────────────────────────────
  console.log("\n── Structure ──");
  check("task_dependencies base table exists",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_dependencies' and table_type='BASE TABLE'`)).rows.length === 1);
  check("columns are exactly the 9 approved",
    (await scalar(c, `select array_agg(column_name order by column_name)::text from information_schema.columns where table_schema='public' and table_name='task_dependencies'`))
      === "{created_at,dependent_id,id,kind,prerequisite_id,removal_reason,removed_at,resolved_at,workspace_id}");
  check("PK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_dependencies'::regclass and contype='p'`)) === 1);
  check("3 FKs present (workspace + 2 composite task)", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_dependencies'::regclass and contype='f'`)) === 3);
  check("both composite task FKs present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_dependencies'::regclass and contype='f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id,%'`)) === 2);
  check("kind/self/state CHECKs present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_dependencies'::regclass and contype='c' and conname in ('task_dependencies_kind_valid','task_dependencies_no_self','task_dependencies_state_consistency')`)) === 3);
  check("active-only unique index present", (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexname='task_dependencies_active_edge_idx' and indexdef ilike '%where ((resolved_at is null) and (removed_at is null))%'`)) === 1);
  check("immutability trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='task_dependencies_enforce_immutable' and not tgisinternal`)) === 1);
  check("cycle-guard trigger present (insert+update)", (await scalar(c, `select count(*)::int from pg_trigger where tgname='task_dependencies_cycle_guard' and not tgisinternal`)) === 1);
  check("RLS enabled + forced", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.task_dependencies'::regclass`)) === true);
  check("both traversal indexes present", (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexname in ('task_dependencies_prereq_active_idx','task_dependencies_dependent_active_idx')`)) === 2);

  // ── Dependency states ──────────────────────────────────────────────────────
  console.log("\n── Dependency states ──");
  await reset(c);
  check("ACTIVE state accepted", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B })).error === null);
  check("RESOLVED state accepted", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.C, resolved_at: NOW })).error === null);
  check("REMOVED state accepted", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.D, removed_at: NOW, removal_reason: "manual" })).error === null);
  check("resolved+removed BOTH populated rejected", (await insDep(c, { dependent_id: T.B, prerequisite_id: T.C, resolved_at: NOW, removed_at: NOW, removal_reason: "x" })).error !== null);
  check("removal_reason WITHOUT removed_at rejected", (await insDep(c, { dependent_id: T.B, prerequisite_id: T.D, removal_reason: "orphan" })).error !== null);
  check("removed_at WITHOUT meaningful removal_reason rejected", (await insDep(c, { dependent_id: T.B, prerequisite_id: T.E, removed_at: NOW })).error !== null);
  check("removed_at with EMPTY removal_reason rejected", (await insDep(c, { dependent_id: T.C, prerequisite_id: T.E, removed_at: NOW, removal_reason: "   " })).error !== null);
  check("resolved WITH removal_reason rejected", (await insDep(c, { dependent_id: T.D, prerequisite_id: T.E, resolved_at: NOW, removal_reason: "x" })).error !== null);

  // ── Values & FKs ───────────────────────────────────────────────────────────
  console.log("\n── Values & FKs ──");
  await reset(c);
  check("hard accepted", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).error === null);
  check("info accepted", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.C, kind: "info" })).error === null);
  check("unknown kind rejected", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.D, kind: "soft" })).error !== null);
  check("self-dependency rejected", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.A })).error !== null);
  check("same-workspace dependency accepted", (await insDep(c, { dependent_id: T.D, prerequisite_id: T.E })).error === null);
  check("cross-workspace dependent rejected", (await insDep(c, { workspace_id: WS1, dependent_id: T.W1, prerequisite_id: T.B })).error !== null);
  check("cross-workspace prerequisite rejected", (await insDep(c, { workspace_id: WS1, dependent_id: T.B, prerequisite_id: T.W1 })).error !== null);
  check("nonexistent dependent rejected", (await insDep(c, { dependent_id: "00000000-0000-0000-0000-0000000000ee", prerequisite_id: T.B })).error !== null);
  check("nonexistent prerequisite rejected", (await insDep(c, { dependent_id: T.B, prerequisite_id: "00000000-0000-0000-0000-0000000000ee" })).error !== null);

  // ── History & uniqueness ───────────────────────────────────────────────────
  console.log("\n── History & uniqueness ──");
  await reset(c);
  const e1 = await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" });
  check("duplicate ACTIVE edge rejected", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).error !== null);
  check("hard and info between same pair coexist", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "info" })).error === null);
  await c.query(`update public.task_dependencies set resolved_at='${NOW}' where id=$1`, [e1.rows[0].id]);
  check("resolved edge retained", (await scalar(c, `select count(*)::int from public.task_dependencies where id='${e1.rows[0].id}'`)) === 1);
  check("same relationship re-added after resolution", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).error === null);
  await reset(c);
  const e2 = await insDep(c, { dependent_id: T.C, prerequisite_id: T.D, kind: "hard" });
  await c.query(`update public.task_dependencies set removed_at='${NOW}', removal_reason='manual' where id=$1`, [e2.rows[0].id]);
  check("removed edge retained", (await scalar(c, `select removed_at is not null from public.task_dependencies where id='${e2.rows[0].id}'`)) === true);
  check("same relationship re-added after removal", (await insDep(c, { dependent_id: T.C, prerequisite_id: T.D, kind: "hard" })).error === null);

  // ── Immutability ───────────────────────────────────────────────────────────
  console.log("\n── Immutability (only resolved_at/removed_at/removal_reason mutable) ──");
  await reset(c);
  const im = (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).rows[0].id;
  await c.query(`update public.task_dependencies set resolved_at='${NOW}' where id=$1`, [im]);
  check("resolved_at update succeeds", (await scalar(c, `select resolved_at is not null from public.task_dependencies where id='${im}'`)) === true);
  const im2 = (await insDep(c, { dependent_id: T.C, prerequisite_id: T.D, kind: "hard" })).rows[0].id;
  await c.query(`update public.task_dependencies set removed_at='${NOW}', removal_reason='gone' where id=$1`, [im2]);
  check("removed_at + removal_reason update succeeds", (await scalar(c, `select removed_at is not null and removal_reason='gone' from public.task_dependencies where id='${im2}'`)) === true);
  await c.query(`update public.task_dependencies set dependent_id='${T.E}', prerequisite_id='${T.E}', kind='info', workspace_id='${WS2}', created_at=now()-interval '1 year' where id=$1`, [im2]);
  const held = (await c.query(`select dependent_id,prerequisite_id,kind,workspace_id from public.task_dependencies where id='${im2}'`)).rows[0];
  check("dependent_id held immutable", held.dependent_id === T.C);
  check("prerequisite_id held immutable", held.prerequisite_id === T.D);
  check("kind held immutable", held.kind === "hard");
  check("workspace_id held immutable", held.workspace_id === WS1);

  // ── Cycle guard ────────────────────────────────────────────────────────────
  console.log("\n── Cycle guard ──");
  await reset(c);
  await insDep(c, { dependent_id: T.A, prerequisite_id: T.B });
  check("direct 2-task hard cycle rejected", (await insDep(c, { dependent_id: T.B, prerequisite_id: T.A })).error !== null);
  await reset(c);
  await insDep(c, { dependent_id: T.A, prerequisite_id: T.B });
  await insDep(c, { dependent_id: T.B, prerequisite_id: T.C });
  check("3-task hard cycle rejected", (await insDep(c, { dependent_id: T.C, prerequisite_id: T.A })).error !== null);
  await reset(c);
  await insDep(c, { dependent_id: T.A, prerequisite_id: T.B });
  await insDep(c, { dependent_id: T.B, prerequisite_id: T.C });
  await insDep(c, { dependent_id: T.C, prerequisite_id: T.D });
  check("longer (4-task) hard cycle rejected", (await insDep(c, { dependent_id: T.D, prerequisite_id: T.A })).error !== null);
  check("valid long chain accepted (already inserted A→B→C→D, no cycle)",
    (await scalar(c, `select count(*)::int from public.task_dependencies where resolved_at is null and removed_at is null`)) === 3);
  await reset(c);
  // diamond DAG: A→B, A→C, B→D, C→D
  check("diamond DAG accepted",
    (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B })).error === null &&
    (await insDep(c, { dependent_id: T.A, prerequisite_id: T.C })).error === null &&
    (await insDep(c, { dependent_id: T.B, prerequisite_id: T.D })).error === null &&
    (await insDep(c, { dependent_id: T.C, prerequisite_id: T.D })).error === null);
  await reset(c);
  check("informational cycle accepted",
    (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "info" })).error === null &&
    (await insDep(c, { dependent_id: T.B, prerequisite_id: T.A, kind: "info" })).error === null);
  await reset(c);
  // hard edge whose reverse path uses only info: info B→A, then hard A→B
  await insDep(c, { dependent_id: T.B, prerequisite_id: T.A, kind: "info" });
  check("hard edge accepted when reverse path is info-only", (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).error === null);
  await reset(c);
  const rce = (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).rows[0].id;
  await c.query(`update public.task_dependencies set resolved_at='${NOW}' where id=$1`, [rce]);
  check("reverse edge accepted after prior path resolved (excluded from traversal)",
    (await insDep(c, { dependent_id: T.B, prerequisite_id: T.A, kind: "hard" })).error === null);
  await reset(c);
  const rme = (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).rows[0].id;
  await c.query(`update public.task_dependencies set removed_at='${NOW}', removal_reason='m' where id=$1`, [rme]);
  check("reverse edge accepted after prior path removed (excluded from traversal)",
    (await insDep(c, { dependent_id: T.B, prerequisite_id: T.A, kind: "hard" })).error === null);
  // reactivation that would create a cycle rejected (UPDATE path)
  await reset(c);
  const ra = (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).rows[0].id;
  await c.query(`update public.task_dependencies set resolved_at='${NOW}' where id=$1`, [ra]);         // A→B inactive
  await insDep(c, { dependent_id: T.B, prerequisite_id: T.A, kind: "hard" });                          // B→A active
  check("reactivation that would create a cycle rejected",
    (await tryQuery(c, `update public.task_dependencies set resolved_at=null where id=$1`, [ra])).error !== null);
  check("cycle detection uses OLD identity regardless of attempted identity change",
    (await tryQuery(c, `update public.task_dependencies set resolved_at=null, prerequisite_id='${T.C}' where id=$1`, [ra])).error !== null);
  // malformed active cycle (via disabled guard) — traversal must TERMINATE
  await reset(c);
  await c.query(`alter table public.task_dependencies disable trigger task_dependencies_cycle_guard`);
  await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" });
  await insDep(c, { dependent_id: T.B, prerequisite_id: T.A, kind: "hard" }); // malformed active cycle
  await c.query(`alter table public.task_dependencies enable trigger task_dependencies_cycle_guard`);
  const term = await tryQuery(c, `set local statement_timeout='4000'; insert into public.task_dependencies (workspace_id,dependent_id,prerequisite_id,kind) values ('${WS1}','${T.C}','${T.A}','hard')`);
  check("traversal terminates safely on malformed active-cycle graph", term.error === null, term.error?.message ?? "");
  await reset(c);

  // ── Boundary ───────────────────────────────────────────────────────────────
  console.log("\n── Boundary ──");
  await reset(c);
  const be = (await insDep(c, { dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).rows[0].id;
  check("adding a hard edge creates NO task_blockers row", (await scalar(c, `select count(*)::int from public.task_blockers`)) === 0);
  await c.query(`update public.task_dependencies set resolved_at='${NOW}' where id=$1`, [be]);
  check("resolving an edge changes NO task_blockers row", (await scalar(c, `select count(*)::int from public.task_blockers`)) === 0);
  check("tasks.blocked_since remains untouched", (await scalar(c, `select count(*)::int from public.tasks where blocked_since is not null`)) === 0);
  check("no new triggers on public.tasks (still 0037's two)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal`)) === 2);
  check("no new triggers on public.task_blockers (still 0038's one)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.task_blockers'::regclass and not tgisinternal`)) === 1);
  const absent = async (t) => (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rows.length === 0;
  check("no 0040–0047 objects", (await absent("labels")) && (await absent("task_labels")) && (await absent("recurring_definitions")) &&
    (await absent("task_reminders")) && (await absent("task_events")) && (await absent("event_redactions")) && (await absent("command_receipts")));

  // ── RLS ────────────────────────────────────────────────────────────────────
  console.log("\n── RLS ──");
  await reset(c);
  const ws1e = (await insDep(c, { workspace_id: WS1, dependent_id: T.A, prerequisite_id: T.B, kind: "hard" })).rows[0].id;
  const ws2e = (await insDep(c, { workspace_id: WS2, dependent_id: T.W1, prerequisite_id: T.W2, kind: "hard" })).rows[0].id;
  check("admin1 sees WS1 dependency", (await runAs(c, "authenticated", U.admin1, `select 1 from public.task_dependencies where id='${ws1e}'`)).rowCount === 1);
  check("admin1 does NOT see WS2 dependency", (await runAs(c, "authenticated", U.admin1, `select 1 from public.task_dependencies where id='${ws2e}'`)).rowCount === 0);
  check("admin3 (WS2) sees only WS2 rows", (await runAs(c, "authenticated", U.admin3, `select distinct workspace_id from public.task_dependencies`)).rows.every((r) => r.workspace_id === WS2));
  check("client sees ZERO", (await runAs(c, "authenticated", U.client, `select * from public.task_dependencies`)).rowCount === 0);
  check("rep sees ZERO", (await runAs(c, "authenticated", U.rep, `select * from public.task_dependencies`)).rowCount === 0);
  check("anon sees ZERO", denied(await runAs(c, "anon", null, `select * from public.task_dependencies`)));
  check("admin cannot INSERT", denied(await runAs(c, "authenticated", U.admin1, `insert into public.task_dependencies (workspace_id,dependent_id,prerequisite_id,kind) values ('${WS1}','${T.C}','${T.D}','hard')`)));
  check("admin cannot UPDATE", denied(await runAs(c, "authenticated", U.admin1, `update public.task_dependencies set resolved_at=now() where id='${ws1e}'`)));
  check("admin cannot DELETE", denied(await runAs(c, "authenticated", U.admin1, `delete from public.task_dependencies where id='${ws1e}'`)));
  check("service_role can read all", (await runAs(c, "service_role", null, `select 1 from public.task_dependencies where id='${ws2e}'`)).rowCount === 1);

  // ── Composition ────────────────────────────────────────────────────────────
  console.log("\n── Composition: real 0027–0039 chain ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  for (const f of ["0027_planner_tasks.sql","0028_calendar_credentials.sql","0029_meetings.sql","0030_meeting_attendees.sql",
    "0031_calendar_projections.sql","0032_meetings_idempotency.sql","0033_create_meeting_rpc.sql","0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql","0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql","0039_planner_task_dependencies.sql"]) {
    const r = await tryQuery(c, sqlFile(f));
    if (r.error) { chainErr = `${f}: ${r.error.message}`; break; }
  }
  check("full 0027–0039 chain applies without collision", chainErr === null, chainErr ?? "");
  check("task_dependencies + task_blockers + tasks + meetings present after chain",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_dependencies'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_blockers'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='tasks'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='meetings'`)).rows.length === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0039 DEPENDENCIES CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
