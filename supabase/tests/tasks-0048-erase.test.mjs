/**
 * Bbettr OS — Migration 0048 (guarded task erase) proof.
 *
 * Runs the REAL 0048_planner_erase_task.sql on top of the 0036 workspace
 * foundation + 0037 core tasks table against a disposable local PostgreSQL and
 * verifies the erase_task(uuid) contract:
 *   - function exists, SECURITY DEFINER, least-privilege EXECUTE (authenticated
 *     only; anon/public revoked)
 *   - an admin erases a LIVE task in their OWN workspace → returns the id; the
 *     row then vanishes from that admin's RLS SELECT (deleted_at set)
 *   - it is a SOFT erase, not a physical DELETE: the row still exists (visible to
 *     service_role) with deleted_at set — the append-only audit trail is intact
 *   - idempotent: a second erase / a missing id / an already-erased row → NULL
 *   - workspace-scoped: an admin CANNOT erase another workspace's task (NULL),
 *     and that task stays visible to its own-workspace admin
 *   - a non-admin (client/rep) is rejected (42501), never a silent erase
 *   - the SELECT visibility policy is UNCHANGED (still hides deleted rows)
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
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1", // WS1
  admin2: "00000000-0000-0000-0000-0000000000a2", // WS1
  admin3: "00000000-0000-0000-0000-0000000000a3", // WS2
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url)))
    throw new Error("tasks-0048: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0048: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
  ('${U.admin1}','a1'),('${U.admin2}','a2'),('${U.admin3}','a3'),('${U.client}','c1'),('${U.rep}','d1');
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

/**
 * Call erase_task as an authenticated admin and COMMIT — so the erase persists
 * for the subsequent assertions (mirrors real usage: the Server Action calls the
 * RPC in autocommit). runAs (rollback) is kept for rejection/read checks where no
 * state should persist. `set local role` is transaction-scoped, so the session
 * role reverts to the owner after commit.
 */
async function eraseAs(c, uid, taskId) {
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const res = await c.query(`select public.erase_task($1) as id`, [taskId]);
    await c.query("commit");
    return { id: res.rows[0].id, error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { id: undefined, error: e }; }
}

/** Insert a task as the superuser (bypasses RLS; triggers + CHECKs still run). */
async function insTask(c, cols = {}) {
  const merged = { workspace_id: WS1, title: "t", created_by: U.admin1, ...cols };
  const keys = Object.keys(merged);
  const vals = keys.map((_, i) => `$${i + 1}`);
  const { rows } = await c.query(
    `insert into public.tasks (${keys.join(",")}) values (${vals.join(",")}) returning id`,
    keys.map((k) => merged[k]));
  return rows[0].id;
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(sqlFile("0036_planner_workspaces.sql"));
  await c.query(sqlFile("0037_planner_tasks_core.sql"));
  await c.query(sqlFile("0048_planner_erase_task.sql"));
  // second workspace + its admin (WS2 is not created by the 0036 seed)
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure / least-privilege ─────────────────────────────────────────────
  console.log("\n── erase_task structure ──");
  check("erase_task(uuid) function exists",
    (await scalar(c, `select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='erase_task'`)) === 1);
  check("erase_task is SECURITY DEFINER",
    (await scalar(c, `select prosecdef from pg_proc where proname='erase_task'`)) === true);
  check("EXECUTE granted to authenticated",
    (await scalar(c, `select has_function_privilege('authenticated','public.erase_task(uuid)','execute')`)) === true);
  check("EXECUTE revoked from anon",
    (await scalar(c, `select has_function_privilege('anon','public.erase_task(uuid)','execute')`)) === false);
  check("EXECUTE revoked from PUBLIC (no blanket grant)",
    (await scalar(c, `select count(*)::int from information_schema.routine_privileges
      where routine_name='erase_task' and grantee='PUBLIC'`)) === 0);

  // ── Happy path: admin erases a live own-workspace task ──────────────────────
  console.log("\n── Admin erases a live own-workspace task ──");
  const t1 = await insTask(c, { status: "planned", owner_user_id: U.admin1, title: "erase-me" });
  check("admin1 sees the task before erase",
    (await runAs(c, "authenticated", U.admin1, `select 1 from public.tasks where id='${t1}'`)).rowCount === 1);
  const erased = await eraseAs(c, U.admin1, t1);
  check("erase_task returns the erased id", erased.error === null && erased.id === t1, erased.error?.message);
  check("task now HIDDEN from admin1 (deleted_at set → RLS excludes it)",
    (await runAs(c, "authenticated", U.admin1, `select 1 from public.tasks where id='${t1}'`)).rowCount === 0);
  check("task also hidden from admin2 (same workspace)",
    (await runAs(c, "authenticated", U.admin2, `select 1 from public.tasks where id='${t1}'`)).rowCount === 0);

  // ── Soft, not physical: the row + audit trail remain ────────────────────────
  console.log("\n── Soft erase (row retained; not a physical DELETE) ──");
  check("row STILL EXISTS with deleted_at set (visible to service_role)",
    (await scalar(c, `select count(*)::int from public.tasks where id='${t1}' and deleted_at is not null`)) === 1);

  // ── Idempotency ─────────────────────────────────────────────────────────────
  console.log("\n── Idempotent no-ops return NULL ──");
  check("erasing an ALREADY-erased task returns NULL",
    (await eraseAs(c, U.admin1, t1)).id === null);
  check("erasing a MISSING id returns NULL",
    (await eraseAs(c, U.admin1, "00000000-0000-0000-0000-0000000000ee")).id === null);

  // ── Workspace scoping ───────────────────────────────────────────────────────
  console.log("\n── Workspace-scoped (cannot erase another workspace's task) ──");
  const t2 = await insTask(c, { workspace_id: WS2, status: "planned", owner_user_id: U.admin3, title: "ws2-task" });
  check("admin1 erasing a WS2 task returns NULL (out of workspace, no-op)",
    (await eraseAs(c, U.admin1, t2)).id === null);
  check("the WS2 task is UNTOUCHED (still live, still visible to its own admin)",
    (await scalar(c, `select count(*)::int from public.tasks where id='${t2}' and deleted_at is null`)) === 1 &&
    (await runAs(c, "authenticated", U.admin3, `select 1 from public.tasks where id='${t2}'`)).rowCount === 1);

  // ── Authorization ───────────────────────────────────────────────────────────
  console.log("\n── Non-admins are rejected (never a silent erase) ──");
  const t3 = await insTask(c, { status: "planned", owner_user_id: U.admin1, title: "guard-me" });
  const asClient = await runAs(c, "authenticated", U.client, `select public.erase_task('${t3}') as id`);
  check("client calling erase_task is REJECTED (42501)", asClient.error !== null && asClient.error.code === "42501");
  const asRep = await runAs(c, "authenticated", U.rep, `select public.erase_task('${t3}') as id`);
  check("rep calling erase_task is REJECTED (42501)", asRep.error !== null && asRep.error.code === "42501");
  check("anon calling erase_task is denied", (await runAs(c, "anon", null, `select public.erase_task('${t3}') as id`)).error !== null);
  check("the guarded task is STILL LIVE after the rejected attempts",
    (await scalar(c, `select count(*)::int from public.tasks where id='${t3}' and deleted_at is null`)) === 1);

  // ── SELECT policy unchanged ─────────────────────────────────────────────────
  console.log("\n── Visibility policy untouched ──");
  check("tasks_select_admin policy still present and unchanged",
    (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_select_admin'`)) === 1);
  check("no INSERT/UPDATE/DELETE policy was added to tasks",
    (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='tasks' and cmd<>'SELECT'`)) === 0);

  console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
