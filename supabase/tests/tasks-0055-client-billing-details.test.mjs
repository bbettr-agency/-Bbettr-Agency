/**
 * Bbettr OS — Migration 0055 (client billing details) proof.
 *
 * Applies the REAL 0055 on a minimal Portal-identity scaffold (roles, auth.uid(),
 * clients, profiles, is_admin(), current_client_id(), set_updated_at()) against a
 * disposable local PostgreSQL and proves the locked design + access matrix:
 *   - structure: 1:1 (PK = client_id), FK + ON DELETE CASCADE, columns/types,
 *     billing_email_same_as_contact NOT NULL DEFAULT false, modest length CHECKs,
 *     updated_at trigger;
 *   - RLS (enforced as PostgREST would): admin manages all; a client reads /
 *     inserts / updates ONLY its own row; a client CANNOT read or write another
 *     client's row; a client CANNOT delete (no client DELETE policy); anon denied;
 *   - isolation: 0055 adds NO column/policy to clients, does NOT create the
 *     invoice ledger or onboarding_submissions, and performs ZERO backfill.
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0055: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0055: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

// Users + clients (a1 admin; a/b are client users with billing rows; c is a
// client user WITHOUT a row, for the clean insert-own test; rep/none negatives).
const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  userA: "00000000-0000-0000-0000-0000000000c1",
  userB: "00000000-0000-0000-0000-0000000000c2",
  userC: "00000000-0000-0000-0000-0000000000c3",
  rep: "00000000-0000-0000-0000-0000000000d1",
  none: "00000000-0000-0000-0000-0000000000f1",
};
const CL = {
  A: "00000000-0000-0000-0000-0000000000ca",
  B: "00000000-0000-0000-0000-0000000000cb",
  C: "00000000-0000-0000-0000-0000000000cc",
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
create or replace function public.set_updated_at() returns trigger language plpgsql as $fn$
  begin new.updated_at = now(); return new; end; $fn$;

grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_admin_read on public.profiles for select to authenticated using (public.is_admin());
-- clients RLS (baseline to prove 0055 does not add to it).
grant select, insert, update, delete on public.clients to authenticated;
alter table public.clients enable row level security;
create policy clients_admin on public.clients for all using (public.is_admin()) with check (public.is_admin());
create policy clients_own on public.clients for select using (id = public.current_client_id());

insert into auth.users (id,email) values
  ('${U.admin}','admin@t'),('${U.userA}','a@t'),('${U.userB}','b@t'),('${U.userC}','c@t'),('${U.rep}','r@t'),('${U.none}','n@t');
insert into public.clients (id,name,contact_email) values
  ('${CL.A}','Client A','a-contact@t'),('${CL.B}','Client B','b-contact@t'),('${CL.C}','Client C','c-contact@t');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin}','admin',null,'Admin'),
  ('${U.userA}','client','${CL.A}','A'),
  ('${U.userB}','client','${CL.B}','B'),
  ('${U.userC}','client','${CL.C}','C'),
  ('${U.rep}','rep',null,'Rep');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, sql, params = []) { const { rows } = await c.query(sql, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function tryQuery(c, sql, params = []) {
  try { const r = await c.query(sql, params); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { return { rows: [], rowCount: 0, error: e }; }
}
/** Run `sql` as `role` with a JWT sub of `uid`, isolated in a rolled-back tx. */
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
  await c.query(readFileSync(join(MIG, "0055_client_billing_details.sql"), "utf8"));

  const T = "public.client_billing_details";

  // ── Zero backfill: table is empty immediately after the migration ───────────
  console.log("\n── zero backfill ──");
  check("no rows created by the migration", (await scalar(c, `select count(*)::int from ${T}`)) === 0);

  // ── Structure ───────────────────────────────────────────────────────────────
  console.log("\n── structure ──");
  const cols = Object.fromEntries((await c.query(
    `select column_name, data_type, is_nullable, column_default from information_schema.columns
     where table_schema='public' and table_name='client_billing_details'`)).rows.map((r) => [r.column_name, r]));
  check("client_id present", !!cols.client_id);
  check("invoice_name text nullable", cols.invoice_name?.data_type === "text" && cols.invoice_name?.is_nullable === "YES");
  check("company_registration_number text nullable", cols.company_registration_number?.data_type === "text" && cols.company_registration_number?.is_nullable === "YES");
  check("vat_number text nullable", cols.vat_number?.data_type === "text" && cols.vat_number?.is_nullable === "YES");
  check("billing_email text nullable", cols.billing_email?.data_type === "text" && cols.billing_email?.is_nullable === "YES");
  check("billing_email_same_as_contact boolean NOT NULL default false",
    cols.billing_email_same_as_contact?.data_type === "boolean" && cols.billing_email_same_as_contact?.is_nullable === "NO" && /false/.test(cols.billing_email_same_as_contact?.column_default ?? ""));
  check("billing_contact_name / billing_address / po_reference / invoice_instructions all nullable text",
    ["billing_contact_name", "billing_address", "po_reference", "invoice_instructions"].every((k) => cols[k]?.data_type === "text" && cols[k]?.is_nullable === "YES"));
  check("updated_by uuid nullable", cols.updated_by?.data_type === "uuid" && cols.updated_by?.is_nullable === "YES");
  check("created_at / updated_at timestamptz NOT NULL", cols.created_at?.is_nullable === "NO" && cols.updated_at?.is_nullable === "NO");

  // PK on client_id → exactly one row per client.
  const pk = await scalar(c, `select string_agg(a.attname,',') from pg_index i
     join pg_attribute a on a.attrelid=i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid='${T}'::regclass and i.indisprimary`);
  check("PRIMARY KEY is (client_id)", pk === "client_id");

  // ── FK + cascade + 1:1 ───────────────────────────────────────────────────────
  console.log("\n── FK / cascade / one-row-per-client ──");
  check("insert for a NON-existent client rejected (FK)",
    (await tryQuery(c, `insert into ${T} (client_id) values ('00000000-0000-0000-0000-0000000000ee')`)).error !== null);
  check("first billing row for client A accepted", (await tryQuery(c, `insert into ${T} (client_id, invoice_name) values ('${CL.A}','Acme A')`)).error === null);
  check("duplicate row for the SAME client rejected (PK 1:1)", (await tryQuery(c, `insert into ${T} (client_id) values ('${CL.A}')`)).error !== null);
  await c.query(`insert into ${T} (client_id, invoice_name) values ('${CL.B}','Acme B')`);
  await c.query(`delete from public.clients where id='${CL.B}'`);
  check("deleting the client CASCADES its billing row",
    (await scalar(c, `select count(*)::int from ${T} where client_id='${CL.B}'`)) === 0);
  // Re-seed B for RLS tests below.
  await c.query(`insert into public.clients (id,name,contact_email) values ('${CL.B}','Client B','b-contact@t')`);
  await c.query(`insert into public.profiles (id,role,client_id,full_name) values ('${U.userB}','client','${CL.B}','B') on conflict (id) do update set client_id=excluded.client_id`);
  await c.query(`insert into ${T} (client_id, invoice_name) values ('${CL.B}','Acme B')`);

  // ── Length guards (modest) ───────────────────────────────────────────────────
  console.log("\n── length CHECKs ──");
  check("invoice_name 200 chars ok", (await tryQuery(c, `insert into ${T} (client_id, invoice_name) values ('${CL.C}', repeat('x',200))`)).error === null);
  await c.query(`delete from ${T} where client_id='${CL.C}'`);
  check("invoice_name 201 chars rejected", (await tryQuery(c, `insert into ${T} (client_id, invoice_name) values ('${CL.C}', repeat('x',201))`)).error !== null);
  check("vat_number 31 chars rejected", (await tryQuery(c, `insert into ${T} (client_id, vat_number) values ('${CL.C}', repeat('9',31))`)).error !== null);

  // ── updated_at trigger ───────────────────────────────────────────────────────
  console.log("\n── updated_at trigger ──");
  const before = await scalar(c, `select updated_at from ${T} where client_id='${CL.A}'`);
  await new Promise((r) => setTimeout(r, 5));
  await c.query(`update ${T} set invoice_name='Acme A v2' where client_id='${CL.A}'`);
  const after = await scalar(c, `select updated_at from ${T} where client_id='${CL.A}'`);
  check("update bumps updated_at", new Date(after).getTime() > new Date(before).getTime());

  // ── RLS access matrix ────────────────────────────────────────────────────────
  console.log("\n── RLS: admin manages all ──");
  check("admin reads ALL billing rows", (await runAs(c, "authenticated", U.admin, `select * from ${T}`)).rowCount === 2);
  check("admin updates any client's row", (await runAs(c, "authenticated", U.admin, `update ${T} set invoice_name='by admin' where client_id='${CL.A}'`)).rowCount === 1);
  check("admin inserts for a client", (await runAs(c, "authenticated", U.admin, `insert into ${T} (client_id, invoice_name) values ('${CL.C}','admin set')`)).rowCount === 1);
  check("admin can delete a row", (await runAs(c, "authenticated", U.admin, `delete from ${T} where client_id='${CL.A}'`)).rowCount === 1);

  console.log("\n── RLS: client manages ONLY its own ──");
  check("client A reads OWN row (1)", (await runAs(c, "authenticated", U.userA, `select * from ${T} where client_id='${CL.A}'`)).rowCount === 1);
  check("client A reads all → still only own (1)", (await runAs(c, "authenticated", U.userA, `select * from ${T}`)).rowCount === 1);
  check("client A CANNOT read client B's row (0)", (await runAs(c, "authenticated", U.userA, `select * from ${T} where client_id='${CL.B}'`)).rowCount === 0);
  check("client A updates OWN row", (await runAs(c, "authenticated", U.userA, `update ${T} set invoice_name='A self' where client_id='${CL.A}'`)).rowCount === 1);
  check("client A CANNOT update client B's row", denied(await runAs(c, "authenticated", U.userA, `update ${T} set invoice_name='hax' where client_id='${CL.B}'`)));
  check("client C inserts OWN row (fresh)", (await runAs(c, "authenticated", U.userC, `insert into ${T} (client_id, invoice_name) values ('${CL.C}','C self')`)).error === null);
  check("client C CANNOT insert a row for another client", denied(await runAs(c, "authenticated", U.userC, `insert into ${T} (client_id, invoice_name) values ('${CL.A}','spoof')`)));
  check("client A CANNOT DELETE own row (no client DELETE policy)", denied(await runAs(c, "authenticated", U.userA, `delete from ${T} where client_id='${CL.A}'`)));

  console.log("\n── RLS: rep + anon denied ──");
  check("rep sees ZERO billing rows", (await runAs(c, "authenticated", U.rep, `select * from ${T}`)).rowCount === 0);
  check("anon SELECT denied", denied(await runAs(c, "anon", null, `select * from ${T}`)));
  check("anon INSERT denied", denied(await runAs(c, "anon", null, `insert into ${T} (client_id) values ('${CL.A}')`)));

  // ── Isolation: nothing else touched ──────────────────────────────────────────
  console.log("\n── isolation ──");
  check("client_billing_details RLS enabled", (await scalar(c, `select relrowsecurity from pg_class where oid='${T}'::regclass`)) === true);
  check("exactly 4 policies on client_billing_details", (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='client_billing_details'`)) === 4);
  check("0055 added NO policy to clients (still the scaffold's 2)", (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='clients'`)) === 2);
  check("0055 added NO column to clients", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='clients'`)) === 3);
  check("invoice ledger NOT created by 0055", (await scalar(c, `select to_regclass('public.client_invoices') is null`)) === true);
  check("onboarding_submissions NOT created by 0055", (await scalar(c, `select to_regclass('public.onboarding_submissions') is null`)) === true);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0055 CLIENT-BILLING-DETAILS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
