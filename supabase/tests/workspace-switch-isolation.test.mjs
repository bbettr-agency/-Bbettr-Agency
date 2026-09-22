/**
 * Bbettr OS — Workspace Switcher data isolation (Membership S4B) DB proof.
 *
 * S4B adds NO migration; it is the UI layer over S3. This proves the DB-level
 * guarantees the switcher relies on, against the REAL 0060 objects under RLS:
 *   - a user U member of {A,B} (legacy default A), NOT of C;
 *   - the switch setter's validation read authorizes A and B but rejects C;
 *   - a tenant table under membership-aware RLS (the 0061 pattern) lets U read
 *     A's row and B's row but NEVER C's — so switching active A↔B shows only that
 *     workspace's data, and cross-tenant C is always blocked;
 *   - the app's per-workspace filter (client_id = active) returns ONLY that
 *     workspace's rows → A and B data never mix.
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("switch-isolation: DB name must contain 'test'.");
}

const U = { admin: "00000000-0000-0000-0000-0000000000a1", U: "00000000-0000-0000-0000-0000000000c1" };
const CL = { A: "00000000-0000-0000-0000-0000000000ca", B: "00000000-0000-0000-0000-0000000000cb", C: "00000000-0000-0000-0000-0000000000cc" };

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
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role public.user_role not null default 'client', client_id uuid references public.clients(id) on delete set null, full_name text);
create or replace function public.is_admin() returns boolean language sql security definer set search_path=public stable as $fn$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid language sql security definer set search_path=public stable as $fn$ select client_id from profiles where id = auth.uid(); $fn$;
grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
insert into auth.users (id,email) values ('${U.admin}','admin@t'),('${U.U}','u@t');
insert into public.clients (id,name) values ('${CL.A}','MLI Automotive'),('${CL.B}','MLI Parts'),('${CL.C}','Other Co');
insert into public.profiles (id,role,client_id,full_name) values ('${U.admin}','admin',null,'Admin'),('${U.U}','client','${CL.A}','U');
`;

// Representative tenant table with the 0061 membership-aware policy.
const TENANT = `
create table public.tenant_rows (id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete cascade, body text);
grant select, insert, update, delete on public.tenant_rows to authenticated;
alter table public.tenant_rows enable row level security;
create policy "Admins manage all tenant_rows" on public.tenant_rows for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Clients read own tenant_rows" on public.tenant_rows for select to authenticated using (public.is_client_member(client_id));
insert into public.tenant_rows (client_id, body) values ('${CL.A}','A-data'),('${CL.B}','B-data'),('${CL.C}','C-data');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function runAs(c, uid, sql, p = []) {
  try { await c.query("begin"); await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]); const r = await c.query(sql, p); await c.query("rollback"); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const CM = "public.client_members";

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0060_client_members.sql"), "utf8")); // backfill U→A
  await c.query(`insert into ${CM} (user_id, client_id) values ('${U.U}','${CL.B}')`); // U also → B (an admin grant)
  await c.query(TENANT);

  // ── switch setter validation (authorize A/B, reject C) ─────────────────────
  console.log("── switch setter validation ──");
  check("U can activate A (member)", (await runAs(c, U.U, `select 1 from ${CM} where client_id='${CL.A}'`)).rowCount === 1);
  check("U can activate B (member)", (await runAs(c, U.U, `select 1 from ${CM} where client_id='${CL.B}'`)).rowCount === 1);
  check("U CANNOT activate C (not a member) — switch rejected", (await runAs(c, U.U, `select 1 from ${CM} where client_id='${CL.C}'`)).rowCount === 0);

  // ── data isolation: active A shows A, active B shows B, never C ─────────────
  console.log("\n── tenant data isolation (A ↔ B, never C) ──");
  const readActive = (cid) => runAs(c, U.U, `select body from public.tenant_rows where client_id='${cid}'`);
  const a = await readActive(CL.A), b = await readActive(CL.B), cc = await readActive(CL.C);
  check("active A → sees ONLY A-data (1 row)", a.rowCount === 1 && a.rows[0].body === "A-data");
  check("switch to B → sees ONLY B-data (1 row)", b.rowCount === 1 && b.rows[0].body === "B-data");
  check("switch back to A → A-data returns", (await readActive(CL.A)).rows[0].body === "A-data");
  check("C data is NEVER visible to U (RLS blocks cross-tenant)", cc.rowCount === 0);

  // ── no mixing: the per-workspace filter returns only that workspace ─────────
  console.log("\n── no A/B mixing under the app's active-workspace filter ──");
  check("filter=A yields only A rows (no B/C leakage)", (() => { return a.rowCount === 1 && a.rows.every((r) => r.body === "A-data"); })());
  check("filter=B yields only B rows (no A/C leakage)", b.rowCount === 1 && b.rows.every((r) => r.body === "B-data"));
  // RLS authorizes BOTH A and B (the app narrows to one via the active filter);
  // it must authorize neither more nor fewer than the memberships.
  check("unfiltered read authorizes exactly {A,B} (2 rows), never C", (await runAs(c, U.U, `select client_id from public.tenant_rows`)).rowCount === 2);

  // ── direct cross-tenant entity access is blocked ───────────────────────────
  console.log("\n── direct cross-tenant access blocked ──");
  check("U cannot read a specific C row by client_id", (await runAs(c, U.U, `select 1 from public.tenant_rows where client_id='${CL.C}'`)).rowCount === 0);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} WORKSPACE-SWITCH-ISOLATION CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
