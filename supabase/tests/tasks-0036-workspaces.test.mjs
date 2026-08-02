/**
 * Bbettr OS — Migration 0036 (workspace foundation) proof.
 *
 * Runs the REAL migration file 0036_planner_workspaces.sql against a disposable
 * local PostgreSQL scaffolded with the Portal identity model, and verifies:
 *   - idempotency (rerun creates no duplicate workspace rows)
 *   - the single agency workspace exists exactly once
 *   - admin profiles are backfilled; client/rep/no-profile are untouched
 *   - profiles.workspace_id FK is enforced
 *   - current_workspace_id() returns the workspace for admins, NULL otherwise
 *   - workspaces RLS (admin reads own; client/rep/anon zero; writes denied)
 *   - NO Tasks-domain objects are created
 *   - composition with the real 0027–0035 chain (no collision)
 *
 * ⚠️ DESTRUCTIVE: drops and recreates the public + auth schemas. Only ever run
 * against a disposable local/CI Postgres whose database name contains "test".
 *
 * Run:
 *   TEST_DATABASE_URL=postgres://postgres@/planner_test?host=/tmp/pgrun&port=5433 \
 *   node supabase/tests/tasks-0036-workspaces.test.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const WS = "00000000-0000-0000-0000-000000000001"; // fixed agency workspace id

const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1",
  admin2: "00000000-0000-0000-0000-0000000000a2",
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
  none: "00000000-0000-0000-0000-0000000000f1", // auth user, no profile
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  const looksTest = /test/i.test(dbName) || /test/i.test(url);
  const looksLocal =
    /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksTest) throw new Error("tasks-0036: refusing to run — target DB name must contain 'test'.");
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0036: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub','')::uuid
$fn$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
do $$ begin
  if not exists (select 1 from pg_type where typname='user_role') then
    create type public.user_role as enum ('admin','client','rep');
  end if;
end $$;
create table public.clients (id uuid primary key default gen_random_uuid());
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text, email text, avatar_url text,
  created_at timestamptz not null default now()
);
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$fn$;
grant select on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_admin_read on public.profiles for select to authenticated using (public.is_admin());
insert into auth.users (id,email) values
  ('${U.admin1}','eloff@bbettr.test'),('${U.admin2}','ashwin@bbettr.test'),
  ('${U.client}','client@bbettr.test'),('${U.rep}','rep@bbettr.test'),
  ('${U.none}','none@bbettr.test');
insert into public.clients (id) values ('00000000-0000-0000-0000-00000000cccc');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin1}','admin',null,'Eloff'),
  ('${U.admin2}','admin',null,'Ashwin'),
  ('${U.client}','client','00000000-0000-0000-0000-00000000cccc','A Client'),
  ('${U.rep}','rep',null,'A Rep');
-- U.none: NO profile row.
`;

const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");
const sql0036 = () => sqlFile("0036_planner_workspaces.sql");

async function freshScaffold(c) {
  await c.query(`drop schema if exists public cascade; create schema public;
                 drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
}
async function tryQuery(c, text) {
  try { await c.query(text); return { error: null }; }
  catch (e) { return { error: e }; }
}
async function scalar(c, text, params = []) {
  const { rows } = await c.query(text, params);
  return rows[0] ? Object.values(rows[0])[0] : undefined;
}
async function tableExists(c, name) {
  return (await c.query(
    `select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [name])
  ).rows.length > 0;
}
async function runAs(c, role, uid, sql, params = []) {
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    const claims = uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role });
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [claims]);
    const res = await c.query(sql, params);
    await c.query("rollback");
    return { rows: res.rows, rowCount: res.rowCount ?? 0, error: null };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { rows: [], rowCount: 0, error: e };
  }
}
const denied = (r) => r.error !== null || r.rowCount === 0;

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test",
  });
  await c.connect();

  // ── Core apply ──────────────────────────────────────────────────────────
  console.log("\n── Core: apply 0036 once ──");
  await freshScaffold(c);
  const first = await tryQuery(c, sql0036());
  check("0036 applies cleanly", first.error === null, first.error?.message ?? "");
  check("workspaces table exists", await tableExists(c, "workspaces"));
  check("exactly one workspace row", (await scalar(c, `select count(*)::int from public.workspaces`)) === 1);
  check("seeded workspace has fixed id / slug / name",
    (await scalar(c, `select (id='${WS}' and slug='bbettr-agency' and name='Bbettr Agency') from public.workspaces`)) === true);
  check("profiles.workspace_id column added",
    (await c.query(`select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='workspace_id'`)).rows.length === 1);
  check("profiles_workspace_id_idx index exists",
    (await c.query(`select 1 from pg_indexes where schemaname='public' and indexname='profiles_workspace_id_idx'`)).rows.length === 1);

  // ── Backfill ────────────────────────────────────────────────────────────
  console.log("\n── Backfill: admins only ──");
  check("admin1 backfilled to workspace",
    (await scalar(c, `select workspace_id from public.profiles where id='${U.admin1}'`)) === WS);
  check("admin2 backfilled to workspace",
    (await scalar(c, `select workspace_id from public.profiles where id='${U.admin2}'`)) === WS);
  check("client profile workspace_id is NULL (untouched)",
    (await scalar(c, `select workspace_id from public.profiles where id='${U.client}'`)) === null);
  check("rep profile workspace_id is NULL (untouched)",
    (await scalar(c, `select workspace_id from public.profiles where id='${U.rep}'`)) === null);
  check("exactly 2 profiles carry a workspace (both admins)",
    (await scalar(c, `select count(*)::int from public.profiles where workspace_id is not null`)) === 2);

  // ── FK enforcement ────────────────────────────────────────────────────────
  console.log("\n── FK enforcement ──");
  const badFk = await tryQuery(c,
    `update public.profiles set workspace_id='00000000-0000-0000-0000-0000000000ff' where id='${U.admin1}'`);
  check("FK rejects a workspace_id that does not exist",
    badFk.error !== null && /foreign key|violates/i.test(badFk.error.message), badFk.error?.message ?? "");

  // ── current_workspace_id() ────────────────────────────────────────────────
  console.log("\n── current_workspace_id() ──");
  check("SECURITY DEFINER + STABLE + search_path set",
    (await scalar(c, `select p.prosecdef and p.provolatile='s' and array_to_string(p.proconfig,',') like '%search_path%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='current_workspace_id'`)) === true);
  const cwFor = async (uid) => {
    await c.query(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: uid })]);
    const v = await scalar(c, `select public.current_workspace_id()`);
    await c.query(`select set_config('request.jwt.claims','',false)`);
    return v;
  };
  check("current_workspace_id() returns workspace for admin", (await cwFor(U.admin1)) === WS);
  check("current_workspace_id() returns NULL for client (no workspace)", (await cwFor(U.client)) === null);
  check("current_workspace_id() returns NULL for rep", (await cwFor(U.rep)) === null);
  check("current_workspace_id() returns NULL for user without a profile (fail-closed)",
    (await cwFor(U.none)) === null);

  // ── RLS on workspaces ─────────────────────────────────────────────────────
  console.log("\n── workspaces RLS ──");
  check("admin reads exactly their own workspace (1 row)",
    (await runAs(c, "authenticated", U.admin1, `select * from public.workspaces`)).rowCount === 1);
  check("client sees ZERO workspaces",
    (await runAs(c, "authenticated", U.client, `select * from public.workspaces`)).rowCount === 0);
  check("rep sees ZERO workspaces",
    (await runAs(c, "authenticated", U.rep, `select * from public.workspaces`)).rowCount === 0);
  check("anon sees ZERO workspaces", denied(await runAs(c, "anon", null, `select * from public.workspaces`)));
  check("authenticated-without-profile sees ZERO workspaces",
    (await runAs(c, "authenticated", U.none, `select * from public.workspaces`)).rowCount === 0);
  check("admin cannot INSERT a workspace (no write policy)", denied(await runAs(c, "authenticated", U.admin1,
    `insert into public.workspaces (name,slug) values ('x','x')`)));
  check("admin cannot UPDATE a workspace", denied(await runAs(c, "authenticated", U.admin1,
    `update public.workspaces set name='hax' where id='${WS}'`)));
  check("admin cannot DELETE a workspace", denied(await runAs(c, "authenticated", U.admin1,
    `delete from public.workspaces where id='${WS}'`)));
  check("service_role CAN read all workspaces",
    (await runAs(c, "service_role", null, `select * from public.workspaces`)).rowCount === 1);

  // ── No Tasks-domain objects ───────────────────────────────────────────────
  console.log("\n── No Tasks-domain objects created ──");
  const noTasks =
    !(await tableExists(c, "tasks")) && !(await tableExists(c, "task_events")) &&
    !(await tableExists(c, "task_blockers")) && !(await tableExists(c, "task_dependencies")) &&
    !(await tableExists(c, "labels")) && !(await tableExists(c, "command_receipts"));
  check("0036 created NO Tasks-domain tables", noTasks);

  // ── Idempotent rerun ──────────────────────────────────────────────────────
  console.log("\n── Idempotent rerun ──");
  const second = await tryQuery(c, sql0036());
  check("0036 reruns without error", second.error === null, second.error?.message ?? "");
  check("still exactly one workspace row after rerun",
    (await scalar(c, `select count(*)::int from public.workspaces`)) === 1);
  check("backfill unchanged after rerun (still 2 admins)",
    (await scalar(c, `select count(*)::int from public.profiles where workspace_id is not null`)) === 2);

  // ── Composition with the real 0027–0035 chain (no collision) ──────────────
  console.log("\n── Composition: real 0027–0035 chain + 0036 ──");
  await freshScaffold(c);
  let chainErr = null;
  for (const f of [
    "0027_planner_tasks.sql", "0028_calendar_credentials.sql", "0029_meetings.sql",
    "0030_meeting_attendees.sql", "0031_calendar_projections.sql", "0032_meetings_idempotency.sql",
    "0033_create_meeting_rpc.sql", "0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql", "0036_planner_workspaces.sql",
  ]) {
    const r = await tryQuery(c, sqlFile(f));
    if (r.error) { chainErr = `${f}: ${r.error.message}`; break; }
  }
  check("full 0027–0036 chain applies without collision", chainErr === null, chainErr ?? "");
  check("workspaces present after the chain", await tableExists(c, "workspaces"));
  check("legacy tasks removed by 0035, not recreated by 0036", !(await tableExists(c, "tasks")));
  check("meetings still intact (no collision with 0029)", await tableExists(c, "meetings"));

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0036 WORKSPACE CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
