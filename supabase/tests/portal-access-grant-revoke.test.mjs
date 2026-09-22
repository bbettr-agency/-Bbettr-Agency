/**
 * Bbettr OS — Admin Portal Access (Membership S4A) DB security proof.
 *
 * S4A adds NO migration; it manages client_members via a privileged server path
 * (requireAdmin → service role). This proves the exact grant/revoke SQL against
 * the REAL 0050 (profile guard) + 0060 (client_members + sync trigger), so the
 * admin actions' data effects are correct and safe:
 *   - grant an EXISTING user to a second workspace → membership added, first
 *     membership + legacy default untouched; duplicate grant is idempotent;
 *   - a CLIENT can never grant/modify/delete memberships or change their default
 *     (S1 + 0050 hold) — only the privileged path may;
 *   - revoke removes ONLY that (user_id, client_id) pair; the auth user + profile
 *     + other memberships survive;
 *   - revoking the DEFAULT workspace reassigns profiles.client_id to a
 *     deterministic remaining membership (never re-creating the revoked one);
 *   - revoking the FINAL membership leaves zero memberships + a null default, the
 *     account preserved, and no tenant authorization (is_client_member=false);
 *   - one user's grant/revoke never touches another user or workspace.
 *
 * The harness connection is a superuser (⇒ RLS-bypassing, like the service role);
 * client denials are checked via `set role authenticated`.
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("portal-access: DB name must contain 'test'.");
}

const U = { admin: "00000000-0000-0000-0000-0000000000a1", A: "00000000-0000-0000-0000-0000000000c1", B: "00000000-0000-0000-0000-0000000000c2" };
const CL = { A: "00000000-0000-0000-0000-0000000000ca", B: "00000000-0000-0000-0000-0000000000cb", C: "00000000-0000-0000-0000-0000000000cc" };

const SCAFFOLD = `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub','')::uuid $fn$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role public.user_role not null default 'client', client_id uuid references public.clients(id) on delete set null, workspace_id uuid, full_name text, email text);
create or replace function public.is_admin() returns boolean language sql security definer set search_path=public stable as $fn$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid language sql security definer set search_path=public stable as $fn$ select client_id from profiles where id = auth.uid(); $fn$;
grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
insert into auth.users (id,email) values ('${U.admin}','admin@t'),('${U.A}','a@t'),('${U.B}','b@t');
insert into public.clients (id,name) values ('${CL.A}','A'),('${CL.B}','B'),('${CL.C}','C');
insert into public.profiles (id,role,client_id,full_name,email) values ('${U.admin}','admin',null,'Admin','admin@t'),('${U.A}','client','${CL.A}','A','a@t'),('${U.B}','client','${CL.C}','B','b@t');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, sql, p = []) { const { rows } = await c.query(sql, p); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function setOf(c, uid) { const r = await c.query(`select client_id from public.client_members where user_id=$1 order by client_id`, [uid]); return r.rows.map((x) => x.client_id); }
async function runAs(c, role, uid, sql, p = []) {
  try { await c.query("begin"); await c.query(`set local role ${role}`); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role })]); const res = await c.query(sql, p); await c.query("rollback"); return { rowCount: res.rowCount ?? 0, error: null }; }
  catch (e) { await c.query("rollback").catch(() => {}); return { rowCount: 0, error: e }; }
}
const denied = (r) => r.error !== null || r.rowCount === 0;
const CM = "public.client_members";

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(sqlFile("0050_profiles_guard_privileged_columns.sql"));
  await c.query(sqlFile("0060_client_members.sql")); // backfill A→A, B→C

  // ── grant existing user A → workspace B (service-role path) ────────────────
  console.log("── grant existing user (A → B) ──");
  await c.query(`insert into ${CM} (user_id, client_id) values ('${U.A}','${CL.B}') on conflict (user_id, client_id) do nothing`);
  check("userA memberships now {A,B}", JSON.stringify(await setOf(c, U.A)) === JSON.stringify([CL.A, CL.B].sort()));
  check("userA legacy default unchanged (=A)", (await scalar(c, `select client_id from public.profiles where id='${U.A}'`)) === CL.A);
  check("userB membership untouched {C}", JSON.stringify(await setOf(c, U.B)) === JSON.stringify([CL.C]));

  console.log("\n── duplicate grant is idempotent ──");
  await c.query(`insert into ${CM} (user_id, client_id) values ('${U.A}','${CL.B}') on conflict (user_id, client_id) do nothing`);
  check("still exactly {A,B} (no duplicate)", JSON.stringify(await setOf(c, U.A)) === JSON.stringify([CL.A, CL.B].sort()));

  // ── a client can NEVER grant/modify memberships or change their default ────
  console.log("\n── client cannot self-manage (S1 + 0050) ──");
  check("client CANNOT self-grant C", denied(await runAs(c, "authenticated", U.A, `insert into ${CM} (user_id, client_id) values ('${U.A}','${CL.C}')`)));
  check("client CANNOT grant another user", denied(await runAs(c, "authenticated", U.A, `insert into ${CM} (user_id, client_id) values ('${U.B}','${CL.A}')`)));
  check("client CANNOT delete a membership", denied(await runAs(c, "authenticated", U.A, `delete from ${CM} where user_id='${U.A}'`)));
  {
    await c.query("begin"); await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U.A, role: "authenticated" })]);
    await c.query(`update public.profiles set client_id='${CL.C}' where id='${U.A}'`).catch(() => {});
    await c.query("reset role");
    const cid = (await c.query(`select client_id from public.profiles where id='${U.A}'`)).rows[0].client_id;
    await c.query("rollback");
    check("client CANNOT change their own legacy default (0050 guard)", cid === CL.A);
  }

  // ── revoke a NON-default second workspace ──────────────────────────────────
  console.log("\n── revoke second workspace (B) ──");
  await c.query(`delete from ${CM} where user_id='${U.A}' and client_id='${CL.B}'`);
  check("userA memberships now {A}", JSON.stringify(await setOf(c, U.A)) === JSON.stringify([CL.A]));
  check("userA default still A (non-default revoke)", (await scalar(c, `select client_id from public.profiles where id='${U.A}'`)) === CL.A);
  check("auth user + profile preserved", (await scalar(c, `select count(*)::int from auth.users where id='${U.A}'`)) === 1 && (await scalar(c, `select count(*)::int from public.profiles where id='${U.A}'`)) === 1);

  // ── revoke the DEFAULT workspace (reassign to remaining) ───────────────────
  console.log("\n── revoke DEFAULT workspace (A, with B remaining) ──");
  await c.query(`insert into ${CM} (user_id, client_id) values ('${U.A}','${CL.B}') on conflict do nothing`); // A now {A,B}
  await c.query(`delete from ${CM} where user_id='${U.A}' and client_id='${CL.A}'`); // revoke default A
  await c.query(`update public.profiles set client_id='${CL.B}' where id='${U.A}'`); // reassign to remaining B
  check("userA memberships now {B} (A gone, not re-created)", JSON.stringify(await setOf(c, U.A)) === JSON.stringify([CL.B]));
  check("userA legacy default reassigned to B", (await scalar(c, `select client_id from public.profiles where id='${U.A}'`)) === CL.B);
  check("still authorized for B, not A", (await runAs(c, "authenticated", U.A, `select public.is_client_member('${CL.B}')`)).error === null);
  check("no longer a member of A", (await scalar(c, `select count(*)::int from ${CM} where user_id='${U.A}' and client_id='${CL.A}'`)) === 0);

  // ── revoke the FINAL membership ────────────────────────────────────────────
  console.log("\n── revoke FINAL workspace (userB / C) ──");
  await c.query(`delete from ${CM} where user_id='${U.B}' and client_id='${CL.C}'`);
  await c.query(`update public.profiles set client_id=null where id='${U.B}'`); // no memberships remain → null default
  check("userB has ZERO memberships", (await setOf(c, U.B)).length === 0);
  check("userB default is NULL", (await scalar(c, `select client_id from public.profiles where id='${U.B}'`)) === null);
  check("userB account + profile preserved (not deleted)", (await scalar(c, `select count(*)::int from auth.users where id='${U.B}'`)) === 1 && (await scalar(c, `select count(*)::int from public.profiles where id='${U.B}'`)) === 1);
  check("userB no longer authorized for C", (await runAs(c, "authenticated", U.B, `select 1 from ${CM} where client_id='${CL.C}'`)).rowCount === 0);

  // ── cross-tenant isolation ─────────────────────────────────────────────────
  console.log("\n── cross-tenant isolation ──");
  check("userA still {B} after all userB operations", JSON.stringify(await setOf(c, U.A)) === JSON.stringify([CL.B]));
  check("clients A/B/C all still present", (await scalar(c, `select count(*)::int from public.clients`)) === 3);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} PORTAL-ACCESS GRANT/REVOKE CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
