/**
 * Bbettr OS — P3-A Admin Intakes access + dismissal proof (behaviour, NO migration).
 *
 * Applies the REAL 0058 schema on a disposable local PostgreSQL and proves the
 * admin-triage access matrix + dismissal semantics AS PostgREST would enforce
 * them (via RLS, no service-role):
 *   - admin CAN read submitted + dismissed intakes; client + anon are denied;
 *   - admin dismiss is a guarded submitted→dismissed UPDATE that PRESERVES the
 *     row and its `data` (never deletes) and cannot touch a converted row;
 *   - a non-admin cannot dismiss.
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("admin: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("admin: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

const U = { admin: "00000000-0000-0000-0000-0000000000a1", userA: "00000000-0000-0000-0000-0000000000c1" };
const CL = { A: "00000000-0000-0000-0000-0000000000ca" };

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
insert into auth.users (id,email) values ('${U.admin}','admin@t'),('${U.userA}','a@t');
insert into public.clients (id,name) values ('${CL.A}','Client A');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin}','admin',null,'Admin'), ('${U.userA}','client','${CL.A}','A');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, sql, p = []) { const { rows } = await c.query(sql, p); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function runAs(c, role, uid, sql, p = []) {
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]);
    const res = await c.query(sql, p);
    await c.query("commit"); // commit so the dismiss UPDATE persists for later checks
    return { rows: res.rows, rowCount: res.rowCount ?? 0, error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const denied = (r) => r.error !== null || r.rowCount === 0;
const T = "public.prospect_intakes";
const h = (ch) => ch.repeat(64);
const FUTURE = "2099-01-01T00:00:00Z";

const IDS = {};
async function seed(c) {
  // Seeded as the table owner (RLS not forced) — pure fixture setup.
  const mk = async (hash, status, data) => {
    const { rows } = await c.query(
      `insert into ${T} (token_hash, token_expires_at, source, status, business_name, email, data, submitted_at)
       values ($1,$2,'generic',$3,$4,$5,$6,$7) returning id`,
      [hash, FUTURE, status, `Biz ${status}`, `${status}@t`, JSON.stringify(data), status === "submitted" ? new Date().toISOString() : null]
    );
    return rows[0].id;
  };
  IDS.submitted = await mk(h("a"), "submitted", { goals: ["More leads"], investment_band: "Under R5,000" });
  IDS.dismissed = await mk(h("b"), "dismissed", { goals: ["Brand awareness"] });
  IDS.draft = await mk(h("c"), "draft", {});
  IDS.converted = await mk(h("d"), "converted", { goals: ["Online sales"] });
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0058_prospect_intakes.sql"), "utf8"));
  await seed(c);
  const total0 = await scalar(c, `select count(*)::int from ${T}`);
  check("4 rows seeded", total0 === 4);

  console.log("\n── admin reads (RLS) ──");
  check("admin CAN read submitted", (await runAs(c, "authenticated", U.admin, `select id from ${T} where status='submitted'`)).rowCount === 1);
  check("admin CAN read dismissed", (await runAs(c, "authenticated", U.admin, `select id from ${T} where status='dismissed'`)).rowCount === 1);
  check("admin sees all four", (await runAs(c, "authenticated", U.admin, `select id from ${T}`)).rowCount === 4);

  console.log("\n── non-admin denied ──");
  check("client CANNOT read", denied(await runAs(c, "authenticated", U.userA, `select id from ${T}`)));
  check("anon CANNOT read", denied(await runAs(c, "anon", null, `select id from ${T}`)));
  check("client CANNOT dismiss", denied(await runAs(c, "authenticated", U.userA, `update ${T} set status='dismissed' where id='${IDS.submitted}' and status='submitted'`)));
  check("submitted row still submitted after client attempt", (await scalar(c, `select status from ${T} where id='${IDS.submitted}'`)) === "submitted");

  console.log("\n── admin dismiss: guarded submitted→dismissed, data preserved, no delete ──");
  const dataBefore = await scalar(c, `select data from ${T} where id='${IDS.submitted}'`);
  const dis = await runAs(c, "authenticated", U.admin, `update ${T} set status='dismissed' where id='${IDS.submitted}' and status='submitted'`);
  check("admin dismiss updates exactly ONE row", dis.rowCount === 1);
  check("row now dismissed", (await scalar(c, `select status from ${T} where id='${IDS.submitted}'`)) === "dismissed");
  check("row still exists (not deleted)", (await scalar(c, `select count(*)::int from ${T} where id='${IDS.submitted}'`)) === 1);
  check("submission data preserved verbatim", JSON.stringify(await scalar(c, `select data from ${T} where id='${IDS.submitted}'`)) === JSON.stringify(dataBefore));

  console.log("\n── guard: converted is never dismissable by the submitted-guarded update ──");
  const conv = await runAs(c, "authenticated", U.admin, `update ${T} set status='dismissed' where id='${IDS.converted}' and status='submitted'`);
  check("converted UPDATE affects zero rows (guard)", conv.rowCount === 0);
  check("converted row untouched", (await scalar(c, `select status from ${T} where id='${IDS.converted}'`)) === "converted");

  console.log("\n── no deletion anywhere ──");
  check("still 4 rows total", (await scalar(c, `select count(*)::int from ${T}`)) === 4);

  console.log(`\n${fail === 0 ? "✅" : "❌"} PROSPECT-INTAKE-ADMIN CHECKS: ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
