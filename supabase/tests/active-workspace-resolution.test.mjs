/**
 * Bbettr OS — Active Workspace (Membership S3) DB integration proof.
 *
 * S3 adds NO migration; it resolves an ACTIVE workspace in the server layer from
 * the user's real memberships + a validated cookie preference. This proves the
 * exact DB reads the S3 server code depends on, against the REAL 0060 objects
 * under RLS, so the (separately unit-tested) pure resolver/setter are fed correct
 * data:
 *   - the membership-set read `select client_id from client_members` (the
 *     resolver's `memberships` input) returns exactly the caller's workspaces;
 *   - the setter's validation read `... where client_id = $1` returns a row ONLY
 *     for a genuine membership (rejects a non-member target);
 *   - revoking a membership shrinks the set (stale active workspace must fall
 *     back); a zero-membership client sees an empty set (resolver fails safe);
 *   - none of these reads can create/alter memberships (S1 isolation holds).
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("active-workspace: DB name must contain 'test'.");
}

const U = { admin: "00000000-0000-0000-0000-0000000000a1", A: "00000000-0000-0000-0000-0000000000c1", B: "00000000-0000-0000-0000-0000000000c2", ghost: "00000000-0000-0000-0000-0000000000c9" };
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
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then
  create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role public.user_role not null default 'client', client_id uuid references public.clients(id) on delete set null, full_name text);
create or replace function public.is_admin() returns boolean language sql security definer set search_path=public stable as $fn$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid language sql security definer set search_path=public stable as $fn$ select client_id from profiles where id = auth.uid(); $fn$;
grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
insert into auth.users (id,email) values ('${U.admin}','a@t'),('${U.A}','a1@t'),('${U.B}','b1@t'),('${U.ghost}','g@t');
insert into public.clients (id,name) values ('${CL.A}','A'),('${CL.B}','B'),('${CL.C}','C');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin}','admin',null,'Admin'),('${U.A}','client','${CL.A}','A'),('${U.B}','client','${CL.C}','B'),('${U.ghost}','client',null,'Ghost');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
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
const setOf = (r) => r.rows.map((x) => x.client_id).sort();
const CM = "public.client_members";

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0060_client_members.sql"), "utf8")); // backfill A→A, B→C; ghost none
  await c.query(`insert into ${CM} (user_id, client_id) values ('${U.A}','${CL.B}')`); // A also → B (simulated S4 grant)

  // ── resolver input: membership-set read under RLS ──────────────────────────
  console.log("── membership-set read (resolver input) ──");
  check("User A memberships = {A,B}", JSON.stringify(setOf(await runAs(c, "authenticated", U.A, `select client_id from ${CM}`))) === JSON.stringify([CL.A, CL.B].sort()));
  check("User B memberships = {C}", JSON.stringify(setOf(await runAs(c, "authenticated", U.B, `select client_id from ${CM}`))) === JSON.stringify([CL.C]));
  // Admins are gated OUT of the client resolver by role BEFORE any membership
  // read (requireClientWorkspace redirects role!=client). At the DB an admin can
  // see all rows via the admin policy, but holds NO membership of their OWN — so
  // they never need one and are never resolved as a client workspace.
  check("Admin holds NO membership of their own", (await runAs(c, "authenticated", U.admin, `select 1 from ${CM} where user_id='${U.admin}'`)).rowCount === 0);
  check("Zero-membership client sees {} (resolver fails safe)", (await runAs(c, "authenticated", U.ghost, `select client_id from ${CM}`)).rowCount === 0);

  // ── setter validation read: row ONLY for a genuine membership ──────────────
  console.log("\n── setter membership validation ──");
  check("User A can validate B (member) → allowed", (await runAs(c, "authenticated", U.A, `select client_id from ${CM} where client_id='${CL.B}'`)).rowCount === 1);
  check("User A canNOT validate C (not a member) → rejected", (await runAs(c, "authenticated", U.A, `select client_id from ${CM} where client_id='${CL.C}'`)).rowCount === 0);
  check("User B canNOT validate A → rejected", (await runAs(c, "authenticated", U.B, `select client_id from ${CM} where client_id='${CL.A}'`)).rowCount === 0);
  check("Zero-membership client validates nothing", (await runAs(c, "authenticated", U.ghost, `select client_id from ${CM} where client_id='${CL.A}'`)).rowCount === 0);

  // ── setter/reads never mutate memberships (S1 isolation holds) ─────────────
  console.log("\n── setter cannot alter memberships / profiles ──");
  check("client CANNOT self-grant a membership (setter never writes CM)", (await runAs(c, "authenticated", U.A, `insert into ${CM} (user_id, client_id) values ('${U.A}','${CL.C}')`)).error !== null);
  const before = (await c.query(`select count(*)::int from ${CM}`)).rows[0].count;

  // ── revoked membership: set shrinks → resolver must fall back ───────────────
  console.log("\n── revoked membership ──");
  await c.query(`delete from ${CM} where user_id='${U.A}' and client_id='${CL.B}'`); // admin revokes B
  check("after revoking B, User A memberships = {A}", JSON.stringify(setOf(await runAs(c, "authenticated", U.A, `select client_id from ${CM}`))) === JSON.stringify([CL.A]));
  check("User A can no longer validate B (stale active must fall back)", (await runAs(c, "authenticated", U.A, `select client_id from ${CM} where client_id='${CL.B}'`)).rowCount === 0);
  check("revocation did not touch profiles.client_id (still A)", (await c.query(`select client_id from public.profiles where id='${U.A}'`)).rows[0].client_id === CL.A);
  check("membership count only dropped by the single revoke", (await c.query(`select count(*)::int from ${CM}`)).rows[0].count === before - 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} ACTIVE-WORKSPACE RESOLUTION CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
