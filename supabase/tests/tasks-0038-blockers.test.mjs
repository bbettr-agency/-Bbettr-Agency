/**
 * Bbettr OS — Migration 0038 (task_blockers) proof.
 *
 * Runs the REAL 0038_planner_task_blockers.sql (on top of 0036 + 0037) against a
 * disposable local PostgreSQL and exhaustively verifies the Waiting detail table:
 * class/reference matrix, blocker_key rules, active-only idempotency, composite
 * same-workspace FKs (incl. nullable MATCH SIMPLE), immutability trigger, RLS,
 * boundary (no 0039–0047 objects; tasks.blocked_since untouched), and chain
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0038: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0038: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
  ('${U.admin1}','admin','Eloff'),('${U.admin3}','admin','WS2 Admin'),
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
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]);
    const res = await c.query(sql, params);
    await c.query("rollback");
    return { rows: res.rows, rowCount: res.rowCount ?? 0, error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const denied = (r) => r.error !== null || r.rowCount === 0;

let TASK_A, TASK_B, TASK_WS2; // referenceable tasks
async function insTask(c, workspace, id) {
  await c.query(`insert into public.tasks (id,workspace_id,title,created_by) values ($1,$2,'ref',$3)`, [id, workspace, U.admin1]);
  return id;
}
/** Insert a blocker as superuser (bypasses RLS; triggers + CHECKs still run). */
async function insBlocker(c, cols = {}) {
  const base = { workspace_id: WS1, task_id: TASK_A };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.task_blockers (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(sqlFile("0036_planner_workspaces.sql"));
  await c.query(sqlFile("0037_planner_tasks_core.sql"));
  await c.query(sqlFile("0038_planner_task_blockers.sql"));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
  TASK_A = await insTask(c, WS1, "00000000-0000-0000-0000-00000000a001");
  TASK_B = await insTask(c, WS1, "00000000-0000-0000-0000-00000000a002");
  TASK_WS2 = await insTask(c, WS2, "00000000-0000-0000-0000-00000000b001");
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure ──────────────────────────────────────────────────────────────
  console.log("\n── Structure ──");
  check("task_blockers base table exists",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_blockers' and table_type='BASE TABLE'`)).rows.length === 1);
  check("PK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_blockers'::regclass and contype='p'`)) === 1);
  check("5 FKs present (workspace, task, ref_task, ref_user, ref_client)",
    (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_blockers'::regclass and contype='f'`)) === 5);
  check("both composite (workspace_id,*) FKs present",
    (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_blockers'::regclass and contype='f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id,%'`)) === 2);
  check("active-only unique index present",
    (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexname='task_blockers_active_key_idx' and indexdef ilike '%where (resolved_at is null)%'`)) === 1);
  check("immutability trigger present",
    (await scalar(c, `select count(*)::int from pg_trigger where tgname='task_blockers_enforce_immutable' and not tgisinternal`)) === 1);
  check("RLS enabled + forced",
    (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.task_blockers'::regclass`)) === true);
  check("both partial indexes present",
    (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexname in ('task_blockers_task_active_idx','task_blockers_ref_task_idx')`)) === 2);

  // ── Legal blocker classes ──────────────────────────────────────────────────
  console.log("\n── Legal classes accepted ──");
  check("person (reference_user_id) accepted",
    (await insBlocker(c, { blocker_class: "person", blocker_key: `person:${U.admin1}`, reference_user_id: U.admin1 })).error === null);
  check("client (reference_client_id) accepted",
    (await insBlocker(c, { blocker_class: "client", blocker_key: `client:${CLIENT_ROW}`, reference_client_id: CLIENT_ROW })).error === null);
  check("dependency (reference_task_id, same ws) accepted",
    (await insBlocker(c, { blocker_class: "dependency", blocker_key: `dependency:${TASK_B}`, reference_task_id: TASK_B })).error === null);
  check("approval (no refs) accepted",
    (await insBlocker(c, { blocker_class: "approval", blocker_key: "approval:homepage-copy" })).error === null);
  check("asset (no refs) accepted",
    (await insBlocker(c, { blocker_class: "asset", blocker_key: "asset:company-logo" })).error === null);

  // ── Illegal class ──────────────────────────────────────────────────────────
  console.log("\n── Illegal class / references rejected ──");
  check("bad blocker_class rejected", (await insBlocker(c, { blocker_class: "bogus", blocker_key: "x:y" })).error !== null);
  check("person WITHOUT reference_user_id rejected",
    (await insBlocker(c, { blocker_class: "person", blocker_key: "person:z" })).error !== null);
  check("person WITH extra reference_task_id rejected",
    (await insBlocker(c, { blocker_class: "person", blocker_key: "person:z2", reference_user_id: U.admin1, reference_task_id: TASK_B })).error !== null);
  check("person with ALL three refs rejected",
    (await insBlocker(c, { blocker_class: "person", blocker_key: "person:z3", reference_user_id: U.admin1, reference_task_id: TASK_B, reference_client_id: CLIENT_ROW })).error !== null);
  check("client WITHOUT reference_client_id rejected",
    (await insBlocker(c, { blocker_class: "client", blocker_key: "client:z" })).error !== null);
  check("dependency WITHOUT reference_task_id rejected",
    (await insBlocker(c, { blocker_class: "dependency", blocker_key: "dependency:z" })).error !== null);
  check("approval WITH reference_user_id rejected",
    (await insBlocker(c, { blocker_class: "approval", blocker_key: "approval:z", reference_user_id: U.admin1 })).error !== null);
  check("asset WITH reference_client_id rejected",
    (await insBlocker(c, { blocker_class: "asset", blocker_key: "asset:z", reference_client_id: CLIENT_ROW })).error !== null);

  // ── blocker_key ────────────────────────────────────────────────────────────
  console.log("\n── blocker_key ──");
  check("empty blocker_key rejected", (await insBlocker(c, { blocker_class: "approval", blocker_key: "   " })).error !== null);

  // ── Multiplicity ───────────────────────────────────────────────────────────
  console.log("\n── Multiplicity ──");
  check("two distinct approval blockers on one task coexist",
    (await insBlocker(c, { task_id: TASK_B, blocker_class: "approval", blocker_key: "approval:a1" })).error === null &&
    (await insBlocker(c, { task_id: TASK_B, blocker_class: "approval", blocker_key: "approval:a2" })).error === null);
  check("two distinct asset blockers coexist",
    (await insBlocker(c, { task_id: TASK_B, blocker_class: "asset", blocker_key: "asset:s1" })).error === null &&
    (await insBlocker(c, { task_id: TASK_B, blocker_class: "asset", blocker_key: "asset:s2" })).error === null);
  check("multiple distinct classes coexist on one task (TASK_A has person/client/dependency/approval/asset)",
    (await scalar(c, `select count(distinct blocker_class)::int from public.task_blockers where task_id='${TASK_A}' and resolved_at is null`)) >= 3);

  // ── Idempotency ────────────────────────────────────────────────────────────
  console.log("\n── Active-only idempotency ──");
  const dupTask = TASK_WS2 ? "00000000-0000-0000-0000-00000000a003" : null;
  await insTask(c, WS1, "00000000-0000-0000-0000-00000000a003");
  const key = "approval:dup";
  const first = await insBlocker(c, { task_id: "00000000-0000-0000-0000-00000000a003", blocker_class: "approval", blocker_key: key });
  check("first active blocker inserted", first.error === null);
  check("duplicate ACTIVE (task,class,key) rejected",
    (await insBlocker(c, { task_id: "00000000-0000-0000-0000-00000000a003", blocker_class: "approval", blocker_key: key })).error !== null);
  await c.query(`update public.task_blockers set resolved_at=now() where id=$1`, [first.rows[0].id]);
  check("same identity re-added after resolution accepted",
    (await insBlocker(c, { task_id: "00000000-0000-0000-0000-00000000a003", blocker_class: "approval", blocker_key: key })).error === null);

  // ── Composite FK / same-workspace ──────────────────────────────────────────
  console.log("\n── Composite FK / same-workspace ──");
  check("cross-workspace task_id rejected",
    (await insBlocker(c, { workspace_id: WS1, task_id: TASK_WS2, blocker_class: "approval", blocker_key: "approval:xw" })).error !== null);
  check("cross-workspace dependency reference_task_id rejected",
    (await insBlocker(c, { workspace_id: WS1, task_id: TASK_A, blocker_class: "dependency", blocker_key: "dependency:xw", reference_task_id: TASK_WS2 })).error !== null);
  check("same-workspace dependency reference accepted",
    (await insBlocker(c, { workspace_id: WS1, task_id: TASK_A, blocker_class: "dependency", blocker_key: `dependency:${TASK_B}:2`, reference_task_id: TASK_B })).error === null);
  check("nonexistent task_id rejected",
    (await insBlocker(c, { task_id: "00000000-0000-0000-0000-0000000000ee", blocker_class: "approval", blocker_key: "approval:no" })).error !== null);
  check("nullable composite FK: approval with null reference_task_id needs no task",
    (await insBlocker(c, { task_id: TASK_A, blocker_class: "approval", blocker_key: "approval:nullref" })).error === null);

  // ── Immutability trigger ───────────────────────────────────────────────────
  console.log("\n── Immutability (only reason + resolved_at mutable) ──");
  const b = (await insBlocker(c, { task_id: TASK_B, blocker_class: "person", blocker_key: "person:imm", reference_user_id: U.admin1, reason: "orig" })).rows[0].id;
  await c.query(`update public.task_blockers set reason='updated' where id=$1`, [b]);
  check("reason update succeeds", (await scalar(c, `select reason from public.task_blockers where id='${b}'`)) === "updated");
  await c.query(`update public.task_blockers set resolved_at=now() where id=$1`, [b]);
  check("resolution (resolved_at) succeeds", (await scalar(c, `select resolved_at is not null from public.task_blockers where id='${b}'`)) === true);
  await c.query(`update public.task_blockers set blocker_key='person:HACKED', blocker_class='asset', reference_user_id=null, task_id='${TASK_A}', workspace_id='${WS2}', created_at=now() - interval '1 year' where id=$1`, [b]);
  check("blocker_key held immutable", (await scalar(c, `select blocker_key from public.task_blockers where id='${b}'`)) === "person:imm");
  check("blocker_class held immutable", (await scalar(c, `select blocker_class from public.task_blockers where id='${b}'`)) === "person");
  check("reference_user_id held immutable", (await scalar(c, `select reference_user_id from public.task_blockers where id='${b}'`)) === U.admin1);
  check("task_id held immutable", (await scalar(c, `select task_id from public.task_blockers where id='${b}'`)) === TASK_B);
  check("workspace_id held immutable", (await scalar(c, `select workspace_id from public.task_blockers where id='${b}'`)) === WS1);

  // ── RLS ────────────────────────────────────────────────────────────────────
  console.log("\n── RLS ──");
  const ws1Blk = (await insBlocker(c, { workspace_id: WS1, task_id: TASK_A, blocker_class: "approval", blocker_key: "approval:rls-ws1" })).rows[0].id;
  const ws2Blk = (await insBlocker(c, { workspace_id: WS2, task_id: TASK_WS2, blocker_class: "approval", blocker_key: "approval:rls-ws2" })).rows[0].id;
  check("admin1 sees WS1 blocker",
    (await runAs(c, "authenticated", U.admin1, `select 1 from public.task_blockers where id='${ws1Blk}'`)).rowCount === 1);
  check("admin1 does NOT see WS2 blocker",
    (await runAs(c, "authenticated", U.admin1, `select 1 from public.task_blockers where id='${ws2Blk}'`)).rowCount === 0);
  check("admin3 (WS2) sees only WS2 blockers",
    (await runAs(c, "authenticated", U.admin3, `select distinct workspace_id from public.task_blockers`)).rows.every((r) => r.workspace_id === WS2));
  check("client sees ZERO", (await runAs(c, "authenticated", U.client, `select * from public.task_blockers`)).rowCount === 0);
  check("rep sees ZERO", (await runAs(c, "authenticated", U.rep, `select * from public.task_blockers`)).rowCount === 0);
  check("anon sees ZERO", denied(await runAs(c, "anon", null, `select * from public.task_blockers`)));
  check("authenticated-without-profile sees ZERO",
    (await runAs(c, "authenticated", U.none, `select * from public.task_blockers`)).rowCount === 0);
  check("admin cannot INSERT", denied(await runAs(c, "authenticated", U.admin1,
    `insert into public.task_blockers (workspace_id,task_id,blocker_class,blocker_key) values ('${WS1}','${TASK_A}','approval','approval:hax')`)));
  check("admin cannot UPDATE", denied(await runAs(c, "authenticated", U.admin1, `update public.task_blockers set reason='hax' where id='${ws1Blk}'`)));
  check("admin cannot DELETE", denied(await runAs(c, "authenticated", U.admin1, `delete from public.task_blockers where id='${ws1Blk}'`)));
  check("service_role can read all", (await runAs(c, "service_role", null, `select 1 from public.task_blockers where id='${ws2Blk}'`)).rowCount === 1);

  // ── Boundary ───────────────────────────────────────────────────────────────
  console.log("\n── Boundary ──");
  const absent = async (t) => (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rows.length === 0;
  check("no 0039–0047 tables",
    (await absent("task_dependencies")) && (await absent("labels")) && (await absent("task_labels")) &&
    (await absent("recurring_definitions")) && (await absent("task_reminders")) && (await absent("task_events")) &&
    (await absent("event_redactions")) && (await absent("command_receipts")));
  check("tasks.blocked_since UNTOUCHED (still null despite active blockers)",
    (await scalar(c, `select count(*)::int from public.tasks where blocked_since is not null`)) === 0);
  check("no trigger on public.tasks was added by 0038",
    (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal`)) === 2); // only 0037's two

  // ── Composition ────────────────────────────────────────────────────────────
  console.log("\n── Composition: real 0027–0038 chain ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  for (const f of ["0027_planner_tasks.sql","0028_calendar_credentials.sql","0029_meetings.sql","0030_meeting_attendees.sql",
    "0031_calendar_projections.sql","0032_meetings_idempotency.sql","0033_create_meeting_rpc.sql","0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql","0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql"]) {
    const r = await tryQuery(c, sqlFile(f));
    if (r.error) { chainErr = `${f}: ${r.error.message}`; break; }
  }
  check("full 0027–0038 chain applies without collision", chainErr === null, chainErr ?? "");
  check("task_blockers + tasks + meetings present after chain",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_blockers'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='tasks'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='meetings'`)).rows.length === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0038 BLOCKERS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
