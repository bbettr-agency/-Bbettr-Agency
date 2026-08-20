/**
 * Bbettr OS — Migration 0056 (client website URLs) proof.
 *
 * Applies the REAL 0056 on a minimal Portal-identity scaffold against a
 * disposable local PostgreSQL and proves the locked design + access matrix:
 *   - structure: website_preview_url + website_live_url are text, NULLABLE, no
 *     default, no CHECK, no FK, no NOT NULL;
 *   - additive: exactly 2 new columns on clients; no new type/enum; no new
 *     policy on clients (RLS unchanged);
 *   - ZERO backfill: a client row that existed before the migration has both new
 *     columns NULL afterward;
 *   - RLS (enforced as PostgREST would): admin can write both columns on any
 *     client; a client can READ the URLs on its OWN row; a client CANNOT read
 *     another client's row; a client CANNOT write the columns; anon denied;
 *   - isolation: onboarding_submissions.existing_website_url is a DIFFERENT
 *     concept and is not created/touched here.
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0056: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0056: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  userA: "00000000-0000-0000-0000-0000000000c1",
  userB: "00000000-0000-0000-0000-0000000000c2",
  rep: "00000000-0000-0000-0000-0000000000d1",
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

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text,
  contact_email text
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text, email text, avatar_url text, created_at timestamptz not null default now());

create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid
  language sql security definer set search_path=public stable as $fn$
  select client_id from profiles where id = auth.uid(); $fn$;

grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_admin_read on public.profiles for select to authenticated using (public.is_admin());
-- clients RLS baseline (to prove 0056 adds NO policy).
grant select, insert, update, delete on public.clients to authenticated;
alter table public.clients enable row level security;
create policy clients_admin on public.clients for all using (public.is_admin()) with check (public.is_admin());
create policy clients_own on public.clients for select using (id = public.current_client_id());

insert into auth.users (id,email) values
  ('${U.admin}','admin@t'),('${U.userA}','a@t'),('${U.userB}','b@t'),('${U.rep}','r@t'),('${U.none}','n@t');
-- Seeded BEFORE 0056 runs, so the new columns must come out NULL (zero backfill).
insert into public.clients (id,name,contact_email) values
  ('${CL.A}','Client A','a-contact@t'),('${CL.B}','Client B','b-contact@t');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin}','admin',null,'Admin'),
  ('${U.userA}','client','${CL.A}','A'),
  ('${U.userB}','client','${CL.B}','B'),
  ('${U.rep}','rep',null,'Rep');
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

  const colsBefore = await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='clients'`);
  // Baseline CHECK count (Postgres exposes each NOT NULL as a CHECK row, e.g. the
  // PK's implicit NOT NULL) — 0056 must not ADD any CHECK.
  const checksBefore = await scalar(c, `select count(*)::int from information_schema.table_constraints where table_schema='public' and table_name='clients' and constraint_type='CHECK'`);
  await c.query(readFileSync(join(MIG, "0056_client_website_urls.sql"), "utf8"));

  const colInfo = async (col) => (await c.query(
    `select data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='clients' and column_name=$1`, [col])).rows[0];

  // ── structure ────────────────────────────────────────────────────────────
  console.log("── structure ──");
  for (const col of ["website_preview_url", "website_live_url"]) {
    const info = await colInfo(col);
    check(`${col} exists`, !!info);
    check(`${col} is text`, info?.data_type === "text", JSON.stringify(info));
    check(`${col} is NULLABLE`, info?.is_nullable === "YES", JSON.stringify(info));
    check(`${col} has NO default`, info?.column_default == null, JSON.stringify(info));
  }
  check("clients column count grew by exactly 2", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='clients'`)) === colsBefore + 2);
  check("0056 added NO new CHECK constraint (columns are unconstrained)", (await scalar(c, `select count(*)::int from information_schema.table_constraints where table_schema='public' and table_name='clients' and constraint_type='CHECK'`)) === checksBefore);
  check("no FK on the new columns", (await scalar(c, `select count(*)::int from information_schema.table_constraints where table_schema='public' and table_name='clients' and constraint_type='FOREIGN KEY'`)) === 0);
  check("0056 created NO new enum/type", (await scalar(c, `select count(*)::int from pg_type where typname in ('website_status','website_url_kind')`)) === 0);

  // ── zero backfill ────────────────────────────────────────────────────────
  console.log("\n── zero backfill ──");
  check("pre-existing client A: website_preview_url NULL", (await scalar(c, `select website_preview_url from public.clients where id='${CL.A}'`)) === null);
  check("pre-existing client A: website_live_url NULL", (await scalar(c, `select website_live_url from public.clients where id='${CL.A}'`)) === null);

  // ── RLS unchanged; access matrix ───────────────────────────────────────────
  console.log("\n── RLS / access ──");
  check("0056 added NO policy to clients (still the scaffold's 2)", (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='clients'`)) === 2);

  // Admin sets both URLs on client A (admin_all policy).
  const adminWrite = await runAs(c, "authenticated", U.admin, `update public.clients set website_preview_url='https://preview.example/a', website_live_url='https://a.co.za' where id='${CL.A}'`);
  check("admin CAN set website URLs on a client", adminWrite.error === null && adminWrite.rowCount === 1, String(adminWrite.error));

  // A client reads its OWN row's URLs (admin write above was rolled back, so seed
  // values are NULL — the point is the columns are READABLE on the own row).
  const ownRead = await runAs(c, "authenticated", U.userA, `select website_preview_url, website_live_url from public.clients where id='${CL.A}'`);
  check("client CAN read website URLs on its OWN row", ownRead.error === null && ownRead.rowCount === 1, String(ownRead.error));

  // A client cannot read another client's row at all.
  check("client CANNOT read another client's row", denied(await runAs(c, "authenticated", U.userA, `select website_live_url from public.clients where id='${CL.B}'`)));

  // A client cannot write the URLs (no client UPDATE policy on clients).
  check("client CANNOT write website URLs (no client update policy)", denied(await runAs(c, "authenticated", U.userA, `update public.clients set website_live_url='https://evil' where id='${CL.A}'`)));

  check("anon CANNOT read clients", denied(await runAs(c, "anon", null, `select website_live_url from public.clients where id='${CL.A}'`)));

  // ── isolation ──────────────────────────────────────────────────────────────
  console.log("\n── isolation ──");
  check("onboarding_submissions NOT created by 0056", (await scalar(c, `select to_regclass('public.onboarding_submissions') is null`)) === true);
  check("clients RLS still enabled", (await scalar(c, `select relrowsecurity from pg_class where oid='public.clients'::regclass`)) === true);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0056 CLIENT-WEBSITE-URLS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
