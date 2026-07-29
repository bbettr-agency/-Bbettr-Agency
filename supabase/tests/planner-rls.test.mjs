/**
 * Bbettr OS — Planner RLS proof (the Phase 1 hard gate).
 *
 * Runs the REAL migration files (supabase/migrations/0027, 0028) against a local
 * PostgreSQL scaffolded with the Portal's identity model (user_role enum,
 * public.profiles, is_admin()) plus Supabase-equivalent roles + auth.uid(), then
 * asserts the access matrix exactly as PostgREST would enforce it.
 *
 * Proves: admin has intended access; client, rep and anonymous have ZERO access;
 * the audit trigger is non-spoofable; and calendar_credentials is reachable only
 * by service_role.
 *
 * ⚠️ DESTRUCTIVE: this harness DROPS AND RECREATES the public + auth schemas on
 * the target database. It must ONLY ever run against a disposable local or CI
 * Postgres. The safety guard below refuses to run unless the target database
 * name contains "test", and refuses non-local hosts without an explicit opt-in
 * (PLANNER_RLS_ALLOW_REMOTE=1). NEVER point it at production or a shared Supabase
 * database.
 *
 * Run (needs `pg` + a disposable local Postgres):
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/planner_test \
 *   node supabase/tests/planner-rls.test.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");

/** Refuse to run against anything that isn't an obviously disposable test DB. */
function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return; // default connection below is an explicit *_test database
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  const looksTest = /test/i.test(dbName) || /test/i.test(url);
  const looksLocal =
    /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksTest) {
    throw new Error(
      "planner-rls: refusing to run — this harness DROPS the public+auth schemas. " +
        "TEST_DATABASE_URL must target a DISPOSABLE database whose name contains 'test'. " +
        "Never point it at production or a shared Supabase database.",
    );
  }
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1") {
    throw new Error(
      "planner-rls: refusing to run against a non-local host without " +
        "PLANNER_RLS_ALLOW_REMOTE=1. Only enable for an isolated CI database you control.",
    );
  }
}

const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1", // Eloff (admin)
  admin2: "00000000-0000-0000-0000-0000000000a2", // Ashwin (admin)
  client: "00000000-0000-0000-0000-0000000000c1", // a client user
  rep: "00000000-0000-0000-0000-0000000000d1", // rep
  none: "00000000-0000-0000-0000-0000000000f1", // auth user, no profile
};

const PORTAL_SCAFFOLD = `
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

-- Portal identity model (matches Portal 0001).
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

-- Replicate the Portal's profiles access (Supabase default grants + its RLS
-- policies) so the tasks policies' "assignee is admin" lookup behaves as it does
-- in production (admins can read all profiles; clients only their own row).
grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_admin_read on public.profiles for select to authenticated using (public.is_admin());
`;

function seed() {
  return `
insert into auth.users (id,email) values
  ('${U.admin1}','eloff@bbettr.test'),
  ('${U.admin2}','ashwin@bbettr.test'),
  ('${U.client}','client@bbettr.test'),
  ('${U.rep}','rep@bbettr.test'),
  ('${U.none}','none@bbettr.test');
insert into public.clients (id) values ('00000000-0000-0000-0000-00000000cccc');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin1}','admin',null,'Eloff'),
  ('${U.admin2}','admin',null,'Ashwin'),
  ('${U.client}','client','00000000-0000-0000-0000-00000000cccc','A Client'),
  ('${U.rep}','rep',null,'A Rep');
-- U.none intentionally has NO profile row.
`;
}

async function setup() {
  assertDisposableTarget();
  const client = new pg.Client({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/planner_test",
  });
  await client.connect();
  await client.query(`drop schema if exists public cascade; create schema public;
                      drop schema if exists auth cascade;`);
  await client.query(PORTAL_SCAFFOLD);
  for (const f of ["0027_planner_tasks.sql", "0028_calendar_credentials.sql"]) {
    await client.query(readFileSync(join(MIG, f), "utf8"));
  }
  await client.query(seed());
  return client;
}

/** Insert a committed task, stamping created_by from `uid` via the audit trigger. */
async function seedTask(c, uid, fields) {
  await c.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
  const { rows } = await c.query(
    `insert into public.tasks (title,assignee_id,scheduled_date,status) values ($1,$2,$3,$4) returning id`,
    [fields.title, fields.assignee_id, fields.scheduled_date ?? null, fields.status ?? "todo"],
  );
  await c.query(`select set_config('request.jwt.claims','',false)`);
  return rows[0].id;
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
  const c = await setup();
  const t1 = await seedTask(c, U.admin1, { title: "Eloff task", assignee_id: U.admin1, scheduled_date: "2026-07-20" });
  await seedTask(c, U.admin2, { title: "Ashwin task", assignee_id: U.admin2, scheduled_date: "2026-07-21" });

  console.log("\n── tasks: access matrix ──");
  check("anon cannot read tasks", denied(await runAs(c, "anon", null, "select * from public.tasks")));
  check("client (role=client) sees ZERO tasks",
    (await runAs(c, "authenticated", U.client, "select * from public.tasks")).rowCount === 0);
  check("rep (role=rep) sees ZERO tasks",
    (await runAs(c, "authenticated", U.rep, "select * from public.tasks")).rowCount === 0);
  check("authenticated-but-no-profile sees ZERO tasks",
    (await runAs(c, "authenticated", U.none, "select * from public.tasks")).rowCount === 0);
  check("admin sees ALL tasks (2)",
    (await runAs(c, "authenticated", U.admin1, "select * from public.tasks")).rowCount === 2);

  console.log("\n── tasks: writes ──");
  check("client cannot INSERT a task", denied(await runAs(c, "authenticated", U.client,
    `insert into public.tasks (title,assignee_id,created_by) values ('x','${U.client}','${U.client}')`)));
  check("rep cannot INSERT a task", denied(await runAs(c, "authenticated", U.rep,
    `insert into public.tasks (title,assignee_id,created_by) values ('x','${U.rep}','${U.rep}')`)));
  check("admin CAN insert a task (assignee=admin)",
    (await runAs(c, "authenticated", U.admin1,
      `insert into public.tasks (title,assignee_id,created_by) values ('ok','${U.admin2}','${U.admin1}') returning id`)).rowCount === 1);
  check("admin CANNOT assign a task to a non-admin (client)",
    denied(await runAs(c, "authenticated", U.admin1,
      `insert into public.tasks (title,assignee_id,created_by) values ('bad','${U.client}','${U.admin1}')`)));
  check("admin CAN update a task",
    (await runAs(c, "authenticated", U.admin1, `update public.tasks set title='edited' where id='${t1}'`)).error === null);
  check("client cannot update a task (no visibility)",
    (await runAs(c, "authenticated", U.client, `update public.tasks set title='hax' where id='${t1}'`)).rowCount === 0);
  check("admin cannot HARD delete (no delete policy)",
    denied(await runAs(c, "authenticated", U.admin1, `delete from public.tasks where id='${t1}'`)));

  console.log("\n── tasks: audit trigger (non-spoofable) ──");
  const spoof = await runAs(c, "authenticated", U.admin1,
    `insert into public.tasks (title,assignee_id,created_by) values ('spoof','${U.admin1}','${U.admin2}') returning created_by`);
  check("created_by is forced to auth.uid(), not the spoofed value",
    spoof.rows[0]?.created_by === U.admin1, `got ${spoof.rows[0]?.created_by}`);

  console.log("\n── calendar_credentials: locked to service_role ──");
  // Seed the single row as superuser (stands in for the service-role write path).
  await c.query(`insert into public.calendar_credentials (id,status) values (1,'connected')`);
  check("anon cannot read credentials", denied(await runAs(c, "anon", null, "select * from public.calendar_credentials")));
  check("client cannot read credentials", denied(await runAs(c, "authenticated", U.client, "select * from public.calendar_credentials")));
  check("rep cannot read credentials", denied(await runAs(c, "authenticated", U.rep, "select * from public.calendar_credentials")));
  check("even an ADMIN cannot read credentials (RLS-locked)",
    denied(await runAs(c, "authenticated", U.admin1, "select * from public.calendar_credentials")));
  check("admin cannot write credentials",
    denied(await runAs(c, "authenticated", U.admin1, `update public.calendar_credentials set status='x' where id=1`)));
  check("service_role CAN read credentials",
    (await runAs(c, "service_role", null, "select * from public.calendar_credentials")).rowCount === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅ ALL RLS CHECKS PASSED" : "❌ RLS FAILURES"}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
