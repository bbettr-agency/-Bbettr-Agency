/**
 * Bbettr OS — Migration 0062 (Jarvis Foundation 1) DB security proof.
 *
 * Applies the REAL 0062 on a minimal agency-workspace scaffold and proves the
 * locked security posture:
 *   - grants/proposals: admins read within THEIR agency workspace only; clients
 *     & anon get nothing; authenticated (even admin) cannot WRITE (service-role
 *     only); a grant is assignable to a NON-admin profile (future staff support);
 *   - action log: append-only & immutable — service_role INSERT+SELECT only,
 *     UPDATE/DELETE rejected for EVERY role (trigger), admins may SELECT, clients
 *     /anon denied;
 *   - cross-workspace isolation: an admin bound to another workspace sees none of
 *     this workspace's Jarvis state.
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
  const db = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("0062: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1"; // agency workspace
const WS2 = "00000000-0000-0000-0000-0000000000e2"; // a second workspace
const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  admin2: "00000000-0000-0000-0000-0000000000a2",
  staff: "00000000-0000-0000-0000-0000000000c1", // NON-admin profile (future staff)
  client: "00000000-0000-0000-0000-0000000000c9",
};
const CL = "00000000-0000-0000-0000-0000000000ca";

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
grant usage on schema auth, public to anon, authenticated, service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then create type public.user_role as enum ('admin','client','rep'); end if; end $$;

create table public.workspaces (id uuid primary key, name text, slug text unique);
create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  workspace_id uuid references public.workspaces(id));
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_workspace_id() returns uuid
  language sql security definer set search_path=public stable as $fn$
  select workspace_id from profiles where id = auth.uid(); $fn$;
grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());

insert into public.workspaces (id,name,slug) values ('${WS}','Agency','agency'),('${WS2}','Other','other');
insert into public.clients (id,name) values ('${CL}','Client A');
insert into auth.users (id,email) values ('${U.admin}','a@t'),('${U.admin2}','a2@t'),('${U.staff}','s@t'),('${U.client}','c@t');
insert into public.profiles (id,role,client_id,workspace_id) values
  ('${U.admin}','admin',null,'${WS}'),
  ('${U.admin2}','admin',null,'${WS2}'),
  ('${U.staff}','client','${CL}',null),   -- a NON-admin profile (future staff)
  ('${U.client}','client','${CL}',null);
`;

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d && !ok ? "  — " + d : ""}`); ok ? pass++ : fail++; };
async function scalar(c, sql, p = []) { const { rows } = await c.query(sql, p); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function tryQ(c, sql, p = []) { try { const r = await c.query(sql, p); return { ok: true, rowCount: r.rowCount ?? 0 }; } catch (e) { return { ok: false, error: e }; } }
async function runAs(c, role, uid, sql, p = []) {
  try { await c.query("begin"); await c.query(`set local role ${role}`); await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]); const r = await c.query(sql, p); await c.query("rollback"); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const denied = (r) => r.error !== null || r.rowCount === 0;

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0062_jarvis_foundation.sql"), "utf8"));

  console.log("── structure ──");
  check("jarvis_capability_grants exists", (await scalar(c, `select to_regclass('public.jarvis_capability_grants') is not null`)) === true);
  check("jarvis_proposals exists", (await scalar(c, `select to_regclass('public.jarvis_proposals') is not null`)) === true);
  check("jarvis_action_events force-RLS", (await scalar(c, `select relforcerowsecurity from pg_class where oid='public.jarvis_action_events'::regclass`)) === true);
  check("append-only trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='jarvis_action_events_no_mutation'`)) === 1);

  console.log("\n── grants: service-role writes, admin reads, staff assignable ──");
  // service_role assigns a grant to a NON-admin profile (future staff) → allowed.
  await c.query(`insert into public.jarvis_capability_grants (workspace_id, subject_user_id, grant_key) values ('${WS}','${U.staff}','jarvis.use')`);
  await c.query(`insert into public.jarvis_capability_grants (workspace_id, subject_user_id, grant_key) values ('${WS}','${U.admin}','bundle:founder')`);
  check("grant assignable to a NON-admin profile (staff support)", (await scalar(c, `select count(*)::int from public.jarvis_capability_grants where subject_user_id='${U.staff}'`)) === 1);
  check("admin CAN read grants in their agency workspace", (await runAs(c, "authenticated", U.admin, `select id from public.jarvis_capability_grants`)).rowCount === 2);
  check("client CANNOT read grants", denied(await runAs(c, "authenticated", U.client, `select id from public.jarvis_capability_grants`)));
  check("anon CANNOT read grants", denied(await runAs(c, "anon", null, `select id from public.jarvis_capability_grants`)));
  check("admin CANNOT write grants (service-role only)", (await runAs(c, "authenticated", U.admin, `insert into public.jarvis_capability_grants (workspace_id, subject_user_id, grant_key) values ('${WS}','${U.admin}','portal.read')`)).error !== null);

  console.log("\n── proposals: admin read, client denied ──");
  await c.query(`insert into public.jarvis_proposals (workspace_id, capability_id, effect_hash, expires_at) values ('${WS}','portal.propose_internal_task','abc', now()+interval '1 day')`);
  check("admin CAN read proposals in agency workspace", (await runAs(c, "authenticated", U.admin, `select id from public.jarvis_proposals`)).rowCount === 1);
  check("client CANNOT read proposals", denied(await runAs(c, "authenticated", U.client, `select id from public.jarvis_proposals`)));

  console.log("\n── action log: append-only & isolated ──");
  await c.query(`insert into public.jarvis_action_events (workspace_id, actor_kind, capability_id, decision) values ('${WS}','human','jarvis.ping','allow')`);
  check("admin CAN read action events", (await runAs(c, "authenticated", U.admin, `select event_id from public.jarvis_action_events`)).rowCount === 1);
  check("client CANNOT read action events", denied(await runAs(c, "authenticated", U.client, `select event_id from public.jarvis_action_events`)));
  check("anon CANNOT read action events", denied(await runAs(c, "anon", null, `select event_id from public.jarvis_action_events`)));
  check("authenticated CANNOT insert action events (service-role only)", (await runAs(c, "authenticated", U.admin, `insert into public.jarvis_action_events (workspace_id, actor_kind, capability_id, decision) values ('${WS}','human','x','allow')`)).error !== null);
  // Append-only: UPDATE/DELETE rejected for EVERY role including the owner.
  check("UPDATE on action events is rejected (append-only)", !(await tryQ(c, `update public.jarvis_action_events set success=true`)).ok);
  check("DELETE on action events is rejected (append-only)", !(await tryQ(c, `delete from public.jarvis_action_events`)).ok);

  console.log("\n── cross-workspace isolation ──");
  check("admin bound to ANOTHER workspace sees no grants here", (await runAs(c, "authenticated", U.admin2, `select id from public.jarvis_capability_grants`)).rowCount === 0);
  check("admin bound to ANOTHER workspace sees no proposals here", (await runAs(c, "authenticated", U.admin2, `select id from public.jarvis_proposals`)).rowCount === 0);
  check("admin bound to ANOTHER workspace sees no action events here", (await runAs(c, "authenticated", U.admin2, `select event_id from public.jarvis_action_events`)).rowCount === 0);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0062 JARVIS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
