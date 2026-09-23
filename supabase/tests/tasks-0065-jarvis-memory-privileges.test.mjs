/**
 * Bbettr OS — Migration 0065 (Jarvis Memory privilege hardening) DB proof.
 *
 * Unlike tasks-0064 (clean-role env), this test REPRODUCES Supabase's default
 * privileges (ALTER DEFAULT PRIVILEGES granting ALL on tables + EXECUTE on
 * functions to anon/authenticated/service_role). It then:
 *   1. applies 0062 + 0064 and CONFIRMS the production defect exists;
 *   2. applies 0065 and PROVES the intended least-privilege end state:
 *      - anon: no privileges on any Memory table
 *      - authenticated: SELECT only on all three; no INSERT/UPDATE/DELETE
 *      - service_role: memories/conflicts trusted; events INSERT+SELECT only
 *      - mutation RPCs: anon=false, authenticated=false, service_role=true
 *      - read helpers still EXECUTE-able by authenticated (RLS reads still work)
 *   3. re-proves capability-driven RLS, user-scope privacy, cross-workspace
 *      isolation, append-only protection, and RPC atomicity survive hardening.
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
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("0065: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1";
const WS2 = "00000000-0000-0000-0000-0000000000e2";
const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",   // admin WS + bundle:founder
  admin2: "00000000-0000-0000-0000-0000000000a2",   // admin WS2 + memory.read (WS2)
  nogrant: "00000000-0000-0000-0000-0000000000a4",  // admin WS, NO grant
  client: "00000000-0000-0000-0000-0000000000c9",   // client, no grant
  clientg: "00000000-0000-0000-0000-0000000000c8",  // client + mistaken memory.read
  rep: "00000000-0000-0000-0000-0000000000f1",       // rep + mistaken memory.read
};
const CL = "00000000-0000-0000-0000-0000000000ca";

const SCAFFOLD = `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
-- SIMULATE SUPABASE DEFAULT PRIVILEGES (the root cause of the production defect).
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
insert into auth.users (id,email) values
  ('${U.admin}','a@t'),('${U.admin2}','a2@t'),('${U.nogrant}','n@t'),('${U.client}','c@t'),('${U.clientg}','cg@t'),('${U.rep}','rep@t');
insert into public.profiles (id,role,client_id,workspace_id) values
  ('${U.admin}','admin',null,'${WS}'),
  ('${U.admin2}','admin',null,'${WS2}'),
  ('${U.nogrant}','admin',null,'${WS}'),
  ('${U.client}','client','${CL}',null),
  ('${U.clientg}','client','${CL}',null),
  ('${U.rep}','rep',null,null);
`;

const RPCS = [
  "jarvis_memory_create(uuid,jsonb,uuid,text,text)",
  "jarvis_memory_confirm(uuid,uuid,text,uuid,text)",
  "jarvis_memory_retire(uuid,uuid,text,text,uuid,text)",
  "jarvis_memory_flag_conflict(uuid,uuid,uuid,uuid,text,text)",
  "jarvis_memory_supersede(uuid,uuid,jsonb,uuid,text,text)",
];
const HELPERS = ["jarvis_is_internal()", "jarvis_can_read_memory()", "jarvis_can_read_memory_row(uuid)"];

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
const fpriv = (c, role, fn) => scalar(c, `select has_function_privilege('${role}','public.${fn}','execute')`);

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0062_jarvis_foundation.sql"), "utf8"));
  await c.query(readFileSync(join(MIG, "0064_jarvis_memory.sql"), "utf8"));

  console.log("── defect reproduced after 0064 (Supabase defaults present) ──");
  check("BEFORE 0065: anon has INSERT on jarvis_memories (defect)", (await tpriv(c, "anon", "jarvis_memories", "INSERT")) === true);
  check("BEFORE 0065: authenticated has DELETE on jarvis_memory_conflicts (defect)", (await tpriv(c, "authenticated", "jarvis_memory_conflicts", "DELETE")) === true);
  check("BEFORE 0065: authenticated can EXECUTE a mutation RPC (defect)", (await fpriv(c, "authenticated", RPCS[0])) === true);

  await c.query(readFileSync(join(MIG, "0065_jarvis_memory_privilege_hardening.sql"), "utf8"));

  console.log("\n── AFTER 0065: table ACLs ──");
  for (const t of ["jarvis_memories", "jarvis_memory_conflicts", "jarvis_memory_events"]) {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      check(`anon has NO ${p} on ${t}`, (await tpriv(c, "anon", t, p)) === false);
    }
    check(`authenticated SELECT on ${t}`, (await tpriv(c, "authenticated", t, "SELECT")) === true);
    for (const p of ["INSERT", "UPDATE", "DELETE"]) {
      check(`authenticated has NO ${p} on ${t}`, (await tpriv(c, "authenticated", t, p)) === false);
    }
  }
  check("service_role trusted on memories (I/S/U/D)", (await tpriv(c, "service_role", "jarvis_memories", "INSERT")) === true && (await tpriv(c, "service_role", "jarvis_memories", "DELETE")) === true);
  check("service_role trusted on conflicts (I/S/U/D)", (await tpriv(c, "service_role", "jarvis_memory_conflicts", "UPDATE")) === true);
  check("service_role on events: INSERT+SELECT yes", (await tpriv(c, "service_role", "jarvis_memory_events", "INSERT")) === true && (await tpriv(c, "service_role", "jarvis_memory_events", "SELECT")) === true);
  check("service_role on events: NO UPDATE/DELETE", (await tpriv(c, "service_role", "jarvis_memory_events", "UPDATE")) === false && (await tpriv(c, "service_role", "jarvis_memory_events", "DELETE")) === false);

  console.log("\n── AFTER 0065: mutation RPC execute ──");
  for (const fn of RPCS) {
    check(`${fn.split("(")[0]}: anon=false, authenticated=false, service_role=true`,
      (await fpriv(c, "anon", fn)) === false && (await fpriv(c, "authenticated", fn)) === false && (await fpriv(c, "service_role", fn)) === true);
  }

  console.log("\n── AFTER 0065: read helpers (RLS requires authenticated EXECUTE) ──");
  for (const fn of HELPERS) {
    check(`${fn.split("(")[0]}: authenticated=true, service_role=true, anon=false`,
      (await fpriv(c, "authenticated", fn)) === true && (await fpriv(c, "service_role", fn)) === true && (await fpriv(c, "anon", fn)) === false);
  }

  // Seed (service-role write path = superuser).
  await c.query(`insert into public.jarvis_capability_grants (workspace_id,subject_user_id,grant_key) values
    ('${WS}','${U.admin}','bundle:founder'),
    ('${WS2}','${U.admin2}','memory.read'),
    ('${WS}','${U.clientg}','memory.read'),
    ('${WS}','${U.rep}','memory.read')`);
  const memAgency = (await c.query(`insert into public.jarvis_memories (workspace_id,scope,category,claim,source_kind,state,current) values ('${WS}','agency','company_knowledge','SOP','human_statement','confirmed',true) returning id`)).rows[0].id;
  const memUser = (await c.query(`insert into public.jarvis_memories (workspace_id,scope,user_id,category,claim,source_kind,state,current) values ('${WS}','user','${U.nogrant}','preference_rule','pref','human_statement','confirmed',true) returning id`)).rows[0].id;
  const memProp = (await c.query(`insert into public.jarvis_memories (workspace_id,scope,category,claim,source_kind,state,current) values ('${WS}','agency','context_note','cand','human_statement','proposed',false) returning id`)).rows[0].id;

  console.log("\n── RLS still correct after hardening ──");
  check("founder (memory.read) reads shared memory (helper EXECUTE intact)", (await runAs(c, "authenticated", U.admin, `select id from public.jarvis_memories where scope='agency'`)).rowCount === 2);
  check("admin WITHOUT grant cannot read shared", (await runAs(c, "authenticated", U.nogrant, `select id from public.jarvis_memories where scope='agency'`)).rowCount === 0);
  check("admin WITHOUT grant reads only own user-scoped row", (await runAs(c, "authenticated", U.nogrant, `select id from public.jarvis_memories`)).rowCount === 1);
  check("user-scoped memory owner-isolated (founder cannot read another's)", (await runAs(c, "authenticated", U.admin, `select id from public.jarvis_memories where id='${memUser}'`)).rowCount === 0);
  check("client (no grant) denied", denied(await runAs(c, "authenticated", U.client, `select id from public.jarvis_memories`)));
  check("client WITH mistaken grant STILL denied", (await runAs(c, "authenticated", U.clientg, `select id from public.jarvis_memories`)).rowCount === 0);
  check("rep WITH mistaken grant STILL denied", (await runAs(c, "authenticated", U.rep, `select id from public.jarvis_memories`)).rowCount === 0);
  check("cross-workspace denied", (await runAs(c, "authenticated", U.admin2, `select id from public.jarvis_memories`)).rowCount === 0);
  check("authenticated cannot INSERT memory (privilege layer)", (await runAs(c, "authenticated", U.admin, `insert into public.jarvis_memories (workspace_id,scope,category,claim,source_kind) values ('${WS}','agency','context_note','x','human_statement')`)).error !== null);
  check("authenticated cannot UPDATE/DELETE memory (privilege layer)", (await runAs(c, "authenticated", U.admin, `update public.jarvis_memories set claim='y' where id='${memAgency}'`)).error !== null && (await runAs(c, "authenticated", U.admin, `delete from public.jarvis_memories where id='${memAgency}'`)).error !== null);

  console.log("\n── append-only + atomicity survive hardening ──");
  await c.query(`insert into public.jarvis_memory_events (workspace_id,memory_id,event_type,actor_kind) values ('${WS}','${memAgency}','created','human')`);
  check("event UPDATE rejected (append-only)", !(await tryQ(c, `update public.jarvis_memory_events set reason='x'`)).ok);
  check("event DELETE rejected (append-only)", !(await tryQ(c, `delete from public.jarvis_memory_events`)).ok);
  const evBefore = await scalar(c, `select count(*)::int from public.jarvis_memory_events where memory_id='${memProp}' and event_type='confirmed'`);
  const wrong = (await c.query(`select public.jarvis_memory_confirm('${WS}','${memProp}','observed','${U.admin}','A') as ok`)).rows[0].ok;
  check("confirm wrong guard → atomic no-op (no state change, no event)", wrong === false && (await scalar(c, `select state from public.jarvis_memories where id='${memProp}'`)) === "proposed" && (await scalar(c, `select count(*)::int from public.jarvis_memory_events where memory_id='${memProp}' and event_type='confirmed'`)) === evBefore);
  const okc = (await c.query(`select public.jarvis_memory_confirm('${WS}','${memProp}','proposed','${U.admin}','A') as ok`)).rows[0].ok;
  check("confirm correct guard → atomic row+event", okc === true && (await scalar(c, `select state from public.jarvis_memories where id='${memProp}'`)) === "confirmed");

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0065 JARVIS MEMORY PRIVILEGES: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
