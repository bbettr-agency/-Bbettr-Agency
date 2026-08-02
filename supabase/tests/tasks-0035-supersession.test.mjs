/**
 * Bbettr OS — Migration 0035 (legacy Tasks supersession) proof.
 *
 * Runs the REAL migration file 0035_planner_tasks_supersede_legacy.sql against a
 * disposable local PostgreSQL, exercising every database state the migration
 * must handle safely:
 *
 *   A. Production shape       — 0027 absent → 0035 is a safe no-op.
 *   B. Clean/test shape       — empty 0027 legacy schema → fully removed.
 *   C. Unexpected legacy data — 0027 + one row → ABORT (LegacyDataFound), untouched.
 *   D. Unknown-table collision— non-legacy public.tasks → ABORT, untouched.
 *   E. Rerun                  — no-op after cleanup and in the never-present case.
 *   F. Transactionality       — aborts drop nothing (no partial cleanup).
 *   G. 0027 integrity         — 0027_planner_tasks.sql SHA is unchanged.
 *   H. Schema parity          — Path A (0027 then 0035) and Path B (0035 only)
 *                               converge to the same (empty) Tasks surface.
 *
 * ⚠️ DESTRUCTIVE: drops and recreates the public + auth schemas. Only ever run
 * against a disposable local/CI Postgres whose database name contains "test".
 *
 * Run:
 *   TEST_DATABASE_URL=postgres://postgres@/planner_test?host=/tmp/pgrun&port=5433 \
 *   node supabase/tests/tasks-0035-supersession.test.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const F_0027 = "0027_planner_tasks.sql";
const F_0035 = "0035_planner_tasks_supersede_legacy.sql";

// Known-good baseline SHA-1 of the historical 0027 migration (must never change).
const SHA1_0027 = "c4338b180f892b3e14ec079ee37bfddcb0941432";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  const looksTest = /test/i.test(dbName) || /test/i.test(url);
  const looksLocal =
    /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksTest) {
    throw new Error(
      "tasks-0035: refusing to run — this harness DROPS the public+auth schemas. " +
        "TEST_DATABASE_URL must target a DISPOSABLE database whose name contains 'test'.",
    );
  }
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1") {
    throw new Error(
      "tasks-0035: refusing to run against a non-local host without PLANNER_RLS_ALLOW_REMOTE=1.",
    );
  }
}

// Minimal Portal identity scaffold — just enough for 0027 to apply.
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
insert into auth.users (id,email) values ('${ADMIN}','eloff@bbettr.test');
insert into public.profiles (id,role,full_name) values ('${ADMIN}','admin','Eloff');
`;

const sql0027 = () => readFileSync(join(MIG, F_0027), "utf8");
const sql0035 = () => readFileSync(join(MIG, F_0035), "utf8");

async function freshDb(c) {
  await c.query(`drop schema if exists public cascade; create schema public;
                 drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
}

async function tryQuery(c, text) {
  try {
    await c.query(text);
    return { error: null };
  } catch (e) {
    return { error: e };
  }
}

// Introspection helpers ------------------------------------------------------
async function tableExists(c, name) {
  const { rows } = await c.query(
    `select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [name]);
  return rows.length > 0;
}
async function typeExists(c, name) {
  const { rows } = await c.query(`select 1 from pg_type where typname=$1`, [name]);
  return rows.length > 0;
}
async function functionExists(c, name) {
  const { rows } = await c.query(
    `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=$1`, [name]);
  return rows.length > 0;
}
async function triggerExists(c, name) {
  const { rows } = await c.query(`select 1 from pg_trigger where tgname=$1 and not tgisinternal`, [name]);
  return rows.length > 0;
}
async function rowCount(c, name) {
  const { rows } = await c.query(`select count(*)::int as n from public.${name}`);
  return rows[0].n;
}
/**
 * Catalog-level residue: count every legacy Tasks object still present across
 * the system catalogs (pg_class covers the table AND its indexes; pg_type the
 * enums; pg_proc the audit function; pg_trigger the trigger; pg_policy the RLS
 * policies). Proves the legacy namespace is gone, not merely the table.
 */
async function legacyCatalogResidue(c) {
  const q = async (text) => (await c.query(text)).rows[0].n;
  return {
    pg_class: await q(
      `select count(*)::int n from pg_class cl
         join pg_namespace nsp on nsp.oid = cl.relnamespace
       where nsp.nspname='public' and (cl.relname='tasks' or cl.relname like 'tasks\\_%')`),
    pg_type: await q(
      `select count(*)::int n from pg_type t
         join pg_namespace nsp on nsp.oid = t.typnamespace
       where nsp.nspname='public' and t.typname in ('task_status','task_priority')`),
    pg_proc: await q(
      `select count(*)::int n from pg_proc p
         join pg_namespace nsp on nsp.oid = p.pronamespace
       where nsp.nspname='public' and p.proname='tasks_enforce_audit'`),
    pg_trigger: await q(
      `select count(*)::int n from pg_trigger where tgname='tasks_enforce_audit' and not tgisinternal`),
    pg_policy: await q(
      `select count(*)::int n from pg_policy
       where polname in ('tasks_select_admin','tasks_insert_admin','tasks_update_admin')`),
  };
}

/** Snapshot every Tasks-related object name (tables, types, functions). */
async function tasksSurface(c) {
  const tables = (await c.query(
    `select table_name from information_schema.tables
     where table_schema='public' and (table_name='tasks' or table_name like 'task\\_%')
     order by table_name`)).rows.map(r => r.table_name);
  const types = (await c.query(
    `select typname from pg_type where typname like 'task%' order by typname`)).rows.map(r => r.typname);
  const funcs = (await c.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname like 'tasks%' order by p.proname`)).rows.map(r => r.proname);
  return { tables, types, funcs };
}

// Assertions -----------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
}

async function legacyGone(c) {
  return (
    !(await tableExists(c, "tasks")) &&
    !(await typeExists(c, "task_status")) &&
    !(await typeExists(c, "task_priority")) &&
    !(await functionExists(c, "tasks_enforce_audit")) &&
    !(await triggerExists(c, "tasks_enforce_audit"))
  );
}
async function legacyIntact(c) {
  return (
    (await tableExists(c, "tasks")) &&
    (await typeExists(c, "task_status")) &&
    (await typeExists(c, "task_priority")) &&
    (await functionExists(c, "tasks_enforce_audit")) &&
    (await triggerExists(c, "tasks_enforce_audit"))
  );
}
async function noNewTaskDomain(c) {
  // 0035 must never create new Task-Domain objects.
  return (
    !(await tableExists(c, "workspaces")) &&
    !(await tableExists(c, "task_events")) &&
    !(await tableExists(c, "task_blockers")) &&
    !(await tableExists(c, "task_dependencies")) &&
    !(await tableExists(c, "command_receipts"))
  );
}

async function seedLegacyRow(c) {
  await c.query(`select set_config('request.jwt.claims',$1,false)`,
    [JSON.stringify({ sub: ADMIN, role: "authenticated" })]);
  await c.query(
    `insert into public.tasks (title, assignee_id) values ('legacy row', $1)`, [ADMIN]);
  await c.query(`select set_config('request.jwt.claims','',false)`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/planner_test",
  });
  await c.connect();

  // ── G. Historical migration integrity ──────────────────────────────────
  const sha = createHash("sha1").update(readFileSync(join(MIG, F_0027))).digest("hex");
  check(`G: 0027_planner_tasks.sql SHA-1 unchanged (${sha.slice(0, 8)})`, sha === SHA1_0027,
    sha === SHA1_0027 ? "" : `expected ${SHA1_0027}, got ${sha}`);

  // ── A. Production shape (0027 absent) → no-op ───────────────────────────
  console.log("\n── A. Production shape: 0027 absent ──");
  await freshDb(c);
  const a = await tryQuery(c, sql0035());
  check("A: 0035 succeeds when no legacy table exists", a.error === null, a.error?.message ?? "");
  check("A: no legacy Tasks objects present after 0035", await legacyGone(c));
  check("A: no new Task-Domain objects created", await noNewTaskDomain(c));

  // ── B. Clean/test shape (empty legacy) → removed ────────────────────────
  console.log("\n── B. Clean/test shape: empty legacy 0027 schema ──");
  await freshDb(c);
  await c.query(sql0027());
  check("B: legacy tasks table is empty before 0035", (await rowCount(c, "tasks")) === 0);
  check("B: legacy schema is intact before 0035", await legacyIntact(c));
  const b = await tryQuery(c, sql0035());
  check("B: 0035 succeeds on empty legacy schema", b.error === null, b.error?.message ?? "");
  check("B: legacy table/enums/function/trigger removed", await legacyGone(c));
  const residue = await legacyCatalogResidue(c);
  check("B (catalog): ZERO legacy residue across pg_class/pg_type/pg_proc/pg_trigger/pg_policy",
    Object.values(residue).every((v) => v === 0), JSON.stringify(residue));
  check("B: no new Task-Domain objects created", await noNewTaskDomain(c));

  // ── C. Unexpected legacy data → abort, untouched ────────────────────────
  console.log("\n── C. Unexpected legacy data ──");
  await freshDb(c);
  await c.query(sql0027());
  await seedLegacyRow(c);
  check("C: legacy row seeded", (await rowCount(c, "tasks")) === 1);
  const cc = await tryQuery(c, sql0035());
  check("C: 0035 ABORTS with LegacyDataFound",
    cc.error !== null && /LegacyDataFound/.test(cc.error.message), cc.error?.message ?? "");
  check("C: legacy table + row remain untouched",
    (await tableExists(c, "tasks")) && (await rowCount(c, "tasks")) === 1);
  check("C: no partial cleanup — legacy schema fully intact (transactional)", await legacyIntact(c));

  // ── D. Unknown-table collision → abort, untouched ───────────────────────
  console.log("\n── D. Unknown non-legacy public.tasks collision ──");
  await freshDb(c);
  await c.query(`create table public.tasks (id uuid primary key default gen_random_uuid(), note text)`);
  const d = await tryQuery(c, sql0035());
  check("D: 0035 ABORTS on non-legacy tasks table",
    d.error !== null && /TasksTableCollision/.test(d.error.message), d.error?.message ?? "");
  check("D: unknown table remains untouched",
    (await tableExists(c, "tasks")) &&
      (await c.query(
        `select 1 from information_schema.columns
         where table_schema='public' and table_name='tasks' and column_name='note'`)).rows.length === 1);

  // Also: an already-upgraded (new-domain) tasks table must not be dropped.
  await freshDb(c);
  await c.query(`create table public.tasks (
    id uuid primary key default gen_random_uuid(), workspace_id uuid, owner_user_id uuid,
    aggregate_version int, status text, priority text)`);
  const d2 = await tryQuery(c, sql0035());
  check("D: 0035 ABORTS on an already-upgraded tasks table (has workspace_id)",
    d2.error !== null && /TasksTableCollision/.test(d2.error.message), d2.error?.message ?? "");
  check("D: upgraded table remains untouched", await tableExists(c, "tasks"));

  // ── E. Rerun safety ─────────────────────────────────────────────────────
  console.log("\n── E. Rerun safety ──");
  await freshDb(c);
  const e1a = await tryQuery(c, sql0035());
  const e1b = await tryQuery(c, sql0035());
  check("E: rerun in no-legacy case — both runs succeed (no-op)",
    e1a.error === null && e1b.error === null, e1b.error?.message ?? "");
  await freshDb(c);
  await c.query(sql0027());
  const e2a = await tryQuery(c, sql0035()); // cleans
  const e2b = await tryQuery(c, sql0035()); // no-op
  check("E: rerun after cleanup — first cleans, second is a no-op",
    e2a.error === null && e2b.error === null && (await legacyGone(c)), e2b.error?.message ?? "");

  // ── F. Transactionality of aborts (explicit) ────────────────────────────
  console.log("\n── F. Transactionality: aborts commit no cleanup ──");
  await freshDb(c);
  await c.query(sql0027());
  await seedLegacyRow(c);
  await tryQuery(c, sql0035()); // aborts (data)
  check("F: after a data-abort, enums + function + trigger all still present",
    await legacyIntact(c));

  // ── H. Schema-parity of the Tasks surface after 0035 ────────────────────
  console.log("\n── H. Schema parity: Path A vs Path B after 0035 ──");
  // Path A: production baseline WITHOUT 0027, then 0035.
  await freshDb(c);
  await tryQuery(c, sql0035());
  const surfaceB = await tasksSurface(c); // (Path B = no 0027)
  // Path A: clean env WITH 0027, then 0035.
  await freshDb(c);
  await c.query(sql0027());
  await tryQuery(c, sql0035());
  const surfaceA = await tasksSurface(c); // (Path A = with 0027)
  const emptyA = surfaceA.tables.length === 0 && surfaceA.types.length === 0 && surfaceA.funcs.length === 0;
  const emptyB = surfaceB.tables.length === 0 && surfaceB.types.length === 0 && surfaceB.funcs.length === 0;
  check("H: Path A (with 0027) has an empty Tasks surface after 0035", emptyA,
    JSON.stringify(surfaceA));
  check("H: Path B (no 0027) has an empty Tasks surface after 0035", emptyB,
    JSON.stringify(surfaceB));
  check("H: Path A and Path B Tasks surfaces are identical",
    JSON.stringify(surfaceA) === JSON.stringify(surfaceB));
  console.log(
    "    NOTE: full 0035–0047 schema-parity is a later CI gate; this proves only the 0035 slice.");

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0035 SUPERSESSION CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 1 * 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
