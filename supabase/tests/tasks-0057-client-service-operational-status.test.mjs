/**
 * Bbettr OS — Migration 0057 (client_services.operational_status) proof.
 *
 * Applies the REAL 0057 on a minimal Portal-identity scaffold against a
 * disposable local PostgreSQL and proves the locked design + access matrix:
 *   - structure: operational_status is text, NULLABLE, no default;
 *   - CHECK: the five canonical values + NULL accepted; anything else rejected;
 *   - additive: exactly 1 new column; no new type/enum; onboarding_status intact;
 *   - ZERO backfill: a client_services row that existed before the migration
 *     has operational_status NULL afterward;
 *   - RLS (enforced as PostgREST would): admin can UPDATE the column on any
 *     client; a client can READ its own row's operational_status; a client
 *     CANNOT update it; a client CANNOT read another client's row; anon denied;
 *   - isolation: no new policy on client_services (RLS unchanged).
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0057: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0057: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  userA: "00000000-0000-0000-0000-0000000000c1",
  userB: "00000000-0000-0000-0000-0000000000c2",
  none: "00000000-0000-0000-0000-0000000000f1",
};
const CL = {
  A: "00000000-0000-0000-0000-0000000000ca",
  B: "00000000-0000-0000-0000-0000000000cb",
};

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
do $$ begin if not exists (select 1 from pg_type where typname='service_type') then
  create type public.service_type as enum ('website','google_ads','meta_ads','seo'); end if; end $$;
do $$ begin if not exists (select 1 from pg_type where typname='onboarding_status') then
  create type public.onboarding_status as enum ('not_started','in_progress','submitted','approved'); end if; end $$;

create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text);
create table public.client_services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  service public.service_type not null,
  onboarding_status public.onboarding_status not null default 'not_started',
  created_at timestamptz not null default now(),
  unique (client_id, service));

create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid
  language sql security definer set search_path=public stable as $fn$
  select client_id from profiles where id = auth.uid(); $fn$;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.client_services to authenticated;
alter table public.profiles enable row level security;
alter table public.client_services enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
-- client_services RLS baseline (to prove 0057 adds NO policy).
create policy "Admins manage all services" on public.client_services for all using (public.is_admin()) with check (public.is_admin());
create policy "Clients read own services" on public.client_services for select using (client_id = public.current_client_id());

insert into auth.users (id,email) values
  ('${U.admin}','admin@t'),('${U.userA}','a@t'),('${U.userB}','b@t'),('${U.none}','n@t');
insert into public.clients (id,name) values ('${CL.A}','Client A'),('${CL.B}','Client B');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin}','admin',null,'Admin'),
  ('${U.userA}','client','${CL.A}','A'),
  ('${U.userB}','client','${CL.B}','B');
-- Seeded BEFORE 0057 → operational_status must be NULL afterward (zero backfill).
insert into public.client_services (client_id, service, onboarding_status) values
  ('${CL.A}','website','approved'),
  ('${CL.A}','google_ads','approved'),
  ('${CL.B}','seo','in_progress');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, sql, params = []) { const { rows } = await c.query(sql, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }
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

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);

  const colsBefore = await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='client_services'`);
  await c.query(readFileSync(join(MIG, "0057_client_service_operational_status.sql"), "utf8"));

  const info = (await c.query(
    `select data_type, is_nullable, column_default from information_schema.columns
     where table_schema='public' and table_name='client_services' and column_name='operational_status'`)).rows[0];

  // ── structure ────────────────────────────────────────────────────────────
  console.log("── structure ──");
  check("operational_status exists", !!info);
  check("operational_status is text", info?.data_type === "text", JSON.stringify(info));
  check("operational_status is NULLABLE", info?.is_nullable === "YES", JSON.stringify(info));
  check("operational_status has NO default", info?.column_default == null, JSON.stringify(info));
  check("client_services column count grew by exactly 1", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='client_services'`)) === colsBefore + 1);
  check("no new enum/type created", (await scalar(c, `select count(*)::int from pg_type where typname in ('operational_status','service_status')`)) === 0);
  check("onboarding_status column still present (unchanged)", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='client_services' and column_name='onboarding_status'`)) === 1);

  // ── zero backfill ──────────────────────────────────────────────────────────
  console.log("\n── zero backfill ──");
  check("pre-existing rows: operational_status all NULL", (await scalar(c, `select count(*)::int from public.client_services where operational_status is not null`)) === 0);

  // ── CHECK constraint ────────────────────────────────────────────────────────
  console.log("\n── CHECK ──");
  for (const v of ["not_started", "setup", "in_progress", "active", "paused"]) {
    const r = await runAs(c, "authenticated", U.admin, `update public.client_services set operational_status='${v}' where client_id='${CL.A}' and service='google_ads'`);
    check(`accepts '${v}'`, r.error === null && r.rowCount === 1, String(r.error));
  }
  {
    const r = await runAs(c, "authenticated", U.admin, `update public.client_services set operational_status='bogus' where client_id='${CL.A}' and service='google_ads'`);
    check("rejects an invalid value ('bogus')", r.error !== null);
  }
  {
    const r = await runAs(c, "authenticated", U.admin, `update public.client_services set operational_status=null where client_id='${CL.A}' and service='google_ads'`);
    check("accepts NULL", r.error === null && r.rowCount === 1, String(r.error));
  }

  // ── RLS / access matrix ────────────────────────────────────────────────────
  console.log("\n── RLS / access ──");
  check("admin CAN update operational_status", (await runAs(c, "authenticated", U.admin, `update public.client_services set operational_status='active' where client_id='${CL.A}' and service='google_ads'`)).rowCount === 1);
  check("client CAN read its own operational_status", (await runAs(c, "authenticated", U.userA, `select operational_status from public.client_services where client_id='${CL.A}'`)).rowCount >= 1);
  check("client CANNOT update operational_status (no client update policy)", denied(await runAs(c, "authenticated", U.userA, `update public.client_services set operational_status='paused' where client_id='${CL.A}' and service='google_ads'`)));
  check("client CANNOT read another client's services", denied(await runAs(c, "authenticated", U.userA, `select operational_status from public.client_services where client_id='${CL.B}'`)));
  check("anon CANNOT read client_services", denied(await runAs(c, "anon", null, `select operational_status from public.client_services where client_id='${CL.A}'`)));

  // ── isolation ──────────────────────────────────────────────────────────────
  console.log("\n── isolation ──");
  check("0057 added NO policy to client_services (still the scaffold's 2)", (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='client_services'`)) === 2);
  check("client_services RLS still enabled", (await scalar(c, `select relrowsecurity from pg_class where oid='public.client_services'::regclass`)) === true);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0057 CLIENT-SERVICE-OPERATIONAL-STATUS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
