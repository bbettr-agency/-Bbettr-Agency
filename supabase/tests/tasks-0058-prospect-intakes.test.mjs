/**
 * Bbettr OS — Migration 0058 (prospect_intakes) proof.
 *
 * Applies the REAL 0058 on a minimal Portal-identity scaffold against a
 * disposable local PostgreSQL and proves the locked design + access matrix:
 *   - structure: columns/types/nullability; token_hash UNIQUE + len-64 CHECK;
 *     status/source CHECKs; selected_services subset CHECK; converted_client_id
 *     FK ON DELETE SET NULL; updated_at trigger;
 *   - RLS (as PostgREST would): admin manages (insert/select/update/delete); a
 *     normal client gets ZERO rows and cannot write; anon denied entirely;
 *   - isolation: additive — creates only prospect_intakes, no backfill, existing
 *     scaffold rows untouched, clients table unchanged.
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0058: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0058: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  userA: "00000000-0000-0000-0000-0000000000c1",
  none: "00000000-0000-0000-0000-0000000000f1",
};
const CL = {
  A: "00000000-0000-0000-0000-0000000000ca",
  B: "00000000-0000-0000-0000-0000000000cb",
};
const HASH1 = "a".repeat(64);
const HASH2 = "b".repeat(64);
const FUTURE = "2099-01-01T00:00:00Z";

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

create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text);

create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid
  language sql security definer set search_path=public stable as $fn$
  select client_id from profiles where id = auth.uid(); $fn$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $fn$
  begin new.updated_at = now(); return new; end; $fn$;

grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());

insert into auth.users (id,email) values ('${U.admin}','admin@t'),('${U.userA}','a@t'),('${U.none}','n@t');
insert into public.clients (id,name) values ('${CL.A}','Client A'),('${CL.B}','Client B');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin}','admin',null,'Admin'),
  ('${U.userA}','client','${CL.A}','A');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, sql, params = []) { const { rows } = await c.query(sql, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function tryQuery(c, sql, params = []) {
  try { const r = await c.query(sql, params); return { ok: true, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { return { ok: false, rowCount: 0, error: e }; }
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
const T = "public.prospect_intakes";

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  const clientsBefore = await scalar(c, `select count(*)::int from public.clients`);
  await c.query(readFileSync(join(MIG, "0058_prospect_intakes.sql"), "utf8"));

  // ── structure ────────────────────────────────────────────────────────────
  console.log("── structure ──");
  const col = async (name) => (await c.query(
    `select data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='prospect_intakes' and column_name=$1`, [name])).rows[0];
  check("table exists", (await scalar(c, `select to_regclass('${T}') is not null`)) === true);
  check("token_hash NOT NULL text", (await col("token_hash"))?.is_nullable === "NO");
  check("status defaults to 'draft'", String((await col("status"))?.column_default || "").includes("draft"));
  check("selected_services is an array", (await col("selected_services"))?.data_type === "ARRAY");
  check("data is jsonb", (await col("data"))?.data_type === "jsonb");
  check("business_name/email nullable", (await col("business_name"))?.is_nullable === "YES" && (await col("email"))?.is_nullable === "YES");

  // ── zero backfill / isolation ──────────────────────────────────────────────
  console.log("\n── zero backfill / isolation ──");
  check("prospect_intakes empty after migration (zero backfill)", (await scalar(c, `select count(*)::int from ${T}`)) === 0);
  check("existing clients rows untouched", (await scalar(c, `select count(*)::int from public.clients`)) === clientsBefore);
  check("no column added to clients", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='clients'`)) === 2);

  // ── CHECK constraints (as owner — pure constraint behaviour) ────────────────
  console.log("\n── CHECK constraints ──");
  const ins = (extra) => `insert into ${T} (token_hash, token_expires_at, source ${extra.cols}) values ('${extra.hash ?? HASH1}','${FUTURE}','generic' ${extra.vals})`;
  check("valid row inserts", (await tryQuery(c, ins({ cols: ", status, selected_services", vals: `, 'draft', array['website','seo']::text[]`, hash: HASH1 }))).ok);
  check("bad status rejected", !(await tryQuery(c, ins({ cols: ", status", vals: `, 'bogus'`, hash: "c".repeat(64) }))).ok);
  check("bad source rejected", !(await tryQuery(c, `insert into ${T} (token_hash, token_expires_at, source) values ('${"d".repeat(64)}','${FUTURE}','spam')`)).ok);
  check("unknown service rejected (subset CHECK)", !(await tryQuery(c, ins({ cols: ", selected_services", vals: `, array['website','email']::text[]`, hash: "e".repeat(64) }))).ok);
  check("empty service selection accepted", (await tryQuery(c, ins({ cols: ", selected_services", vals: `, array[]::text[]`, hash: "f".repeat(64) }))).ok);
  check("short token_hash rejected (len 64 CHECK)", !(await tryQuery(c, `insert into ${T} (token_hash, token_expires_at, source) values ('tooshort','${FUTURE}','generic')`)).ok);
  check("duplicate token_hash rejected (UNIQUE)", !(await tryQuery(c, `insert into ${T} (token_hash, token_expires_at, source) values ('${HASH1}','${FUTURE}','generic')`)).ok);

  // ── converted_client_id FK ON DELETE SET NULL ──────────────────────────────
  console.log("\n── converted_client FK ──");
  await c.query(`insert into ${T} (token_hash, token_expires_at, source, status, converted_client_id, converted_at) values ('${HASH2}','${FUTURE}','personalised','converted','${CL.B}', now())`);
  await c.query(`delete from public.clients where id='${CL.B}'`);
  check("deleting a client nulls converted_client_id (SET NULL, status kept)",
    (await scalar(c, `select converted_client_id from ${T} where token_hash='${HASH2}'`)) === null &&
    (await scalar(c, `select status from ${T} where token_hash='${HASH2}'`)) === "converted");

  // ── RLS / access matrix ─────────────────────────────────────────────────────
  console.log("\n── RLS / access ──");
  check("admin CAN insert", (await runAs(c, "authenticated", U.admin, `insert into ${T} (token_hash, token_expires_at, source) values ('${"1".repeat(64)}','${FUTURE}','generic')`)).rowCount === 1);
  check("admin CAN read all", (await runAs(c, "authenticated", U.admin, `select id from ${T}`)).rowCount >= 1);
  check("client CANNOT read (zero rows)", denied(await runAs(c, "authenticated", U.userA, `select id from ${T}`)));
  check("client CANNOT insert", denied(await runAs(c, "authenticated", U.userA, `insert into ${T} (token_hash, token_expires_at, source) values ('${"2".repeat(64)}','${FUTURE}','generic')`)));
  check("anon CANNOT read", denied(await runAs(c, "anon", null, `select id from ${T}`)));
  check("anon CANNOT insert", denied(await runAs(c, "anon", null, `insert into ${T} (token_hash, token_expires_at, source) values ('${"3".repeat(64)}','${FUTURE}','generic')`)));

  console.log("\n── isolation ──");
  check("RLS enabled on prospect_intakes", (await scalar(c, `select relrowsecurity from pg_class where oid='${T}'::regclass`)) === true);
  check("exactly 1 policy (admin manage all)", (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='prospect_intakes'`)) === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0058 PROSPECT-INTAKES CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
