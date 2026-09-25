/**
 * Bbettr OS — Migration 0066 (Jarvis Foundation 1 privilege hardening) DB proof.
 *
 * Reproduces Supabase's default privileges (ALTER DEFAULT PRIVILEGES granting ALL
 * on tables to anon/authenticated), applies 0062 (+0063) and CONFIRMS the surplus
 * ACL on jarvis_capability_grants + jarvis_proposals, then applies 0066 and proves
 * the intended least-privilege end state while F1 RLS + append-only stay intact:
 *   grants/proposals: anon NONE; authenticated SELECT only; service_role trusted.
 *   action_events (untouched by 0066): anon NONE; authenticated SELECT; service_role INSERT+SELECT.
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
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("0066: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1";
const WS2 = "00000000-0000-0000-0000-0000000000e2";
const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  admin2: "00000000-0000-0000-0000-0000000000a2",
  client: "00000000-0000-0000-0000-0000000000c9",
};
const CL = "00000000-0000-0000-0000-0000000000ca";

const SCAFFOLD = `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
-- SIMULATE SUPABASE DEFAULT PRIVILEGES (root cause of the surplus ACLs).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
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
insert into auth.users (id,email) values ('${U.admin}','a@t'),('${U.admin2}','a2@t'),('${U.client}','c@t');
insert into public.profiles (id,role,client_id,workspace_id) values
  ('${U.admin}','admin',null,'${WS}'),
  ('${U.admin2}','admin',null,'${WS2}'),
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
const tpriv = (c, role, tbl, priv) => scalar(c, `select has_table_privilege('${role}','public.${tbl}','${priv}')`);

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0062_jarvis_foundation.sql"), "utf8"));
  await c.query(readFileSync(join(MIG, "0063_jarvis_action_events_fk_carveout.sql"), "utf8"));

  console.log("── defect reproduced after 0062 (Supabase defaults present) ──");
  check("BEFORE 0066: anon has INSERT on jarvis_capability_grants (defect)", (await tpriv(c, "anon", "jarvis_capability_grants", "INSERT")) === true);
  check("BEFORE 0066: authenticated has DELETE on jarvis_proposals (defect)", (await tpriv(c, "authenticated", "jarvis_proposals", "DELETE")) === true);
  check("BEFORE 0066: jarvis_action_events already correct (anon no SELECT)", (await tpriv(c, "anon", "jarvis_action_events", "SELECT")) === false);

  await c.query(readFileSync(join(MIG, "0066_jarvis_foundation_privilege_hardening.sql"), "utf8"));

  console.log("\n── AFTER 0066: table ACLs ──");
  for (const t of ["jarvis_capability_grants", "jarvis_proposals"]) {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) check(`anon has NO ${p} on ${t}`, (await tpriv(c, "anon", t, p)) === false);
    check(`authenticated SELECT on ${t}`, (await tpriv(c, "authenticated", t, "SELECT")) === true);
    for (const p of ["INSERT", "UPDATE", "DELETE"]) check(`authenticated has NO ${p} on ${t}`, (await tpriv(c, "authenticated", t, p)) === false);
    check(`service_role trusted on ${t} (I/S/U/D)`, (await tpriv(c, "service_role", t, "INSERT")) === true && (await tpriv(c, "service_role", t, "DELETE")) === true);
  }

  console.log("\n── jarvis_action_events UNCHANGED by 0066 (still correct) ──");
  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) check(`anon has NO ${p} on jarvis_action_events`, (await tpriv(c, "anon", "jarvis_action_events", p)) === false);
  check("authenticated SELECT-only on jarvis_action_events", (await tpriv(c, "authenticated", "jarvis_action_events", "SELECT")) === true && (await tpriv(c, "authenticated", "jarvis_action_events", "INSERT")) === false);
  check("service_role INSERT+SELECT only on jarvis_action_events", (await tpriv(c, "service_role", "jarvis_action_events", "INSERT")) === true && (await tpriv(c, "service_role", "jarvis_action_events", "SELECT")) === true && (await tpriv(c, "service_role", "jarvis_action_events", "UPDATE")) === false && (await tpriv(c, "service_role", "jarvis_action_events", "DELETE")) === false);

  // Seed rows (service-role write path = superuser here).
  await c.query(`insert into public.jarvis_capability_grants (workspace_id, subject_user_id, grant_key) values ('${WS}','${U.admin}','bundle:founder')`);
  await c.query(`insert into public.jarvis_proposals (workspace_id, capability_id, effect_hash, expires_at) values ('${WS}','portal.propose_internal_task','h', now()+interval '1 day')`);
  await c.query(`insert into public.jarvis_action_events (workspace_id, actor_kind, capability_id, decision) values ('${WS}','human','jarvis.ping','allow')`);

  console.log("\n── F1 RLS intact after 0066 ──");
  check("admin reads grants in workspace", (await runAs(c, "authenticated", U.admin, `select id from public.jarvis_capability_grants`)).rowCount === 1);
  check("client CANNOT read grants", denied(await runAs(c, "authenticated", U.client, `select id from public.jarvis_capability_grants`)));
  check("admin reads proposals in workspace", (await runAs(c, "authenticated", U.admin, `select id from public.jarvis_proposals`)).rowCount === 1);
  check("client CANNOT read proposals", denied(await runAs(c, "authenticated", U.client, `select id from public.jarvis_proposals`)));
  check("admin reads action events", (await runAs(c, "authenticated", U.admin, `select event_id from public.jarvis_action_events`)).rowCount === 1);
  check("cross-workspace admin sees no grants/proposals/events", (await runAs(c, "authenticated", U.admin2, `select id from public.jarvis_capability_grants`)).rowCount === 0 && (await runAs(c, "authenticated", U.admin2, `select id from public.jarvis_proposals`)).rowCount === 0 && (await runAs(c, "authenticated", U.admin2, `select event_id from public.jarvis_action_events`)).rowCount === 0);

  console.log("\n── writes still blocked / append-only intact ──");
  check("authenticated CANNOT write grants (no privilege + no policy)", (await runAs(c, "authenticated", U.admin, `insert into public.jarvis_capability_grants (workspace_id,subject_user_id,grant_key) values ('${WS}','${U.admin}','portal.read')`)).error !== null);
  check("authenticated CANNOT write proposals", (await runAs(c, "authenticated", U.admin, `insert into public.jarvis_proposals (workspace_id,capability_id,effect_hash,expires_at) values ('${WS}','x','h',now())`)).error !== null);
  check("action_events UPDATE rejected (append-only intact)", !(await tryQ(c, `update public.jarvis_action_events set success=true`)).ok);
  check("action_events DELETE rejected (append-only intact)", !(await tryQ(c, `delete from public.jarvis_action_events`)).ok);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0066 JARVIS F1 PRIVILEGES: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
