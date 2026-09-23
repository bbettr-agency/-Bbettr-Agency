/**
 * Bbettr OS — Migration 0064 (Jarvis Memory V1) DB security proof.
 *
 * Applies the REAL 0064 on a minimal agency scaffold and proves:
 *   - jarvis_memories: admins read all in THEIR workspace; a non-admin internal
 *     user reads only their OWN user-scoped rows; clients/anon denied; NO direct
 *     authenticated writes (service-role only); cross-workspace isolation.
 *   - jarvis_memory_events: append-only & immutable (service_role INSERT+SELECT
 *     only; admins SELECT; UPDATE/DELETE rejected) WITH the FK ON DELETE SET NULL
 *     carve-out working (delete a referenced profile/memory nullifies the FK,
 *     nothing else); carve-out cannot mutate a protected field.
 *   - jarvis_memory_supersede(): atomic correction — old superseded/current=false,
 *     new confirmed/current=true, lineage preserved & reconstructable.
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
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("0064: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1";
const WS2 = "00000000-0000-0000-0000-0000000000e2";
const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",  // admin in WS
  admin2: "00000000-0000-0000-0000-0000000000a2",  // admin in WS2
  staff: "00000000-0000-0000-0000-0000000000b1",   // NON-admin internal user bound to WS
  client: "00000000-0000-0000-0000-0000000000c9",  // client (no workspace)
  del: "00000000-0000-0000-0000-0000000000d1",     // referenced by an event's actor
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
insert into auth.users (id,email) values
  ('${U.admin}','a@t'),('${U.admin2}','a2@t'),('${U.staff}','s@t'),('${U.client}','c@t'),('${U.del}','d@t');
insert into public.profiles (id,role,client_id,workspace_id) values
  ('${U.admin}','admin',null,'${WS}'),
  ('${U.admin2}','admin',null,'${WS2}'),
  ('${U.staff}','client',null,'${WS}'),   -- non-admin internal user bound to the agency workspace
  ('${U.client}','client','${CL}',null),
  ('${U.del}','admin',null,'${WS}');
`;

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d && !ok ? "  — " + d : ""}`); ok ? pass++ : fail++; };
async function scalar(c, sql, p = []) { const { rows } = await c.query(sql, p); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function tryQ(c, sql, p = []) { try { const r = await c.query(sql, p); return { ok: true, rowCount: r.rowCount ?? 0, rows: r.rows }; } catch (e) { return { ok: false, error: e }; } }
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
  await c.query(readFileSync(join(MIG, "0064_jarvis_memory.sql"), "utf8"));

  console.log("── structure ──");
  check("jarvis_memories exists (RLS on)", (await scalar(c, `select relrowsecurity from pg_class where oid='public.jarvis_memories'::regclass`)) === true);
  check("jarvis_memory_events force-RLS", (await scalar(c, `select relforcerowsecurity from pg_class where oid='public.jarvis_memory_events'::regclass`)) === true);
  check("append-only trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='jarvis_memory_events_no_mutation'`)) === 1);
  check("supersede function present", (await scalar(c, `select count(*)::int from pg_proc where proname='jarvis_memory_supersede'`)) === 1);

  // Seed memories (as superuser — service_role write path). agency + client + user(staff).
  const memAgency = (await c.query(`insert into public.jarvis_memories (workspace_id,scope,category,claim,source_kind,state,current) values ('${WS}','agency','company_knowledge','Agency SOP','human_statement','confirmed',true) returning id`)).rows[0].id;
  const memClient = (await c.query(`insert into public.jarvis_memories (workspace_id,scope,client_id,category,claim,source_kind,state,current) values ('${WS}','client','${CL}','client_knowledge','Client context','human_statement','confirmed',true) returning id`)).rows[0].id;
  const memUser = (await c.query(`insert into public.jarvis_memories (workspace_id,scope,user_id,category,claim,source_kind,state,current) values ('${WS}','user','${U.staff}','preference_rule','Staff pref','human_statement','confirmed',true) returning id`)).rows[0].id;

  console.log("\n── jarvis_memories RLS ──");
  check("admin reads ALL memory in workspace (3)", (await runAs(c, "authenticated", U.admin, `select id from public.jarvis_memories`)).rowCount === 3);
  check("non-admin internal user reads ONLY own user-scoped row (1)", (await runAs(c, "authenticated", U.staff, `select id from public.jarvis_memories`)).rowCount === 1);
  check("non-admin internal user CANNOT read agency/client memory", (await runAs(c, "authenticated", U.staff, `select id from public.jarvis_memories where scope in ('agency','client')`)).rowCount === 0);
  check("client CANNOT read any memory", denied(await runAs(c, "authenticated", U.client, `select id from public.jarvis_memories`)));
  check("anon CANNOT read memory", denied(await runAs(c, "anon", null, `select id from public.jarvis_memories`)));
  check("authenticated admin CANNOT directly write memory (service-role only)", (await runAs(c, "authenticated", U.admin, `insert into public.jarvis_memories (workspace_id,scope,category,claim,source_kind) values ('${WS}','agency','context_note','x','human_statement')`)).error !== null);
  check("admin in ANOTHER workspace sees no memory here", (await runAs(c, "authenticated", U.admin2, `select id from public.jarvis_memories`)).rowCount === 0);

  // Seed an event referencing a profile actor + a memory.
  await c.query(`insert into public.jarvis_memory_events (workspace_id, memory_id, event_type, actor_kind, actor_user_id, actor_display, reason) values ('${WS}','${memAgency}','created','human','${U.del}','Del','seed')`);
  const EID = (await c.query(`select event_id from public.jarvis_memory_events limit 1`)).rows[0].event_id;

  console.log("\n── jarvis_memory_events append-only + RLS ──");
  check("admin reads memory events", (await runAs(c, "authenticated", U.admin, `select event_id from public.jarvis_memory_events`)).rowCount === 1);
  check("client CANNOT read memory events", denied(await runAs(c, "authenticated", U.client, `select event_id from public.jarvis_memory_events`)));
  check("authenticated CANNOT insert memory events (service-role only)", (await runAs(c, "authenticated", U.admin, `insert into public.jarvis_memory_events (workspace_id,event_type,actor_kind) values ('${WS}','created','human')`)).error !== null);
  check("ordinary UPDATE rejected (append-only)", !(await tryQ(c, `update public.jarvis_memory_events set reason='x' where event_id='${EID}'`)).ok);
  check("DELETE rejected (append-only)", !(await tryQ(c, `delete from public.jarvis_memory_events where event_id='${EID}'`)).ok);
  check("carve-out abuse: null actor + change reason → rejected", !(await tryQ(c, `update public.jarvis_memory_events set actor_user_id=null, reason='x' where event_id='${EID}'`)).ok);

  console.log("\n── FK ON DELETE SET NULL carve-out ──");
  const delActor = await tryQ(c, `delete from public.profiles where id='${U.del}'`);
  check("deleting profile referenced by actor_user_id SUCCEEDS", delActor.ok, delActor.error?.message);
  let ev = (await c.query(`select actor_user_id, event_type, reason, memory_id from public.jarvis_memory_events where event_id='${EID}'`)).rows[0];
  check("actor_user_id nullified; event_type/reason/memory_id intact", ev.actor_user_id === null && ev.event_type === "created" && ev.reason === "seed" && ev.memory_id === memAgency);
  const delMem = await tryQ(c, `delete from public.jarvis_memories where id='${memAgency}'`);
  check("deleting referenced memory SUCCEEDS (memory_id → NULL on event)", delMem.ok, delMem.error?.message);
  ev = (await c.query(`select memory_id, event_type from public.jarvis_memory_events where event_id='${EID}'`)).rows[0];
  check("memory_id nullified; event survives", ev.memory_id === null && ev.event_type === "created");

  console.log("\n── atomic supersession (correction) ──");
  const newId = (await c.query(
    `select public.jarvis_memory_supersede('${WS}','${memClient}', $1::jsonb, '${U.admin}','Eloff','retainer context updated') as id`,
    [JSON.stringify({ scope: "client", client_id: CL, category: "client_knowledge", claim: "Updated client context", source_kind: "human_statement" })]
  )).rows[0].id;
  const oldRow = (await c.query(`select state, current, superseded_by_id from public.jarvis_memories where id='${memClient}'`)).rows[0];
  const newRow = (await c.query(`select state, current, supersedes_id from public.jarvis_memories where id='${newId}'`)).rows[0];
  check("old memory → superseded, current=false, points to new", oldRow.state === "superseded" && oldRow.current === false && oldRow.superseded_by_id === newId);
  check("new memory → confirmed, current=true, supersedes old", newRow.state === "confirmed" && newRow.current === true && newRow.supersedes_id === memClient);
  check("lineage events written (superseded + corrected)", (await scalar(c, `select count(*)::int from public.jarvis_memory_events where memory_id in ('${memClient}','${newId}') and event_type in ('superseded','corrected')`)) === 2);
  check("supersede is atomic: superseding an already-superseded row is rejected", !(await tryQ(c, `select public.jarvis_memory_supersede('${WS}','${memClient}', '{"scope":"client","client_id":"${CL}","category":"client_knowledge","claim":"x","source_kind":"human_statement"}'::jsonb, '${U.admin}','Eloff','again')`)).ok);

  console.log("\n── service_role privileges ──");
  const evPrivs = (await c.query(`select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='jarvis_memory_events' and grantee='service_role' order by 1`)).rows.map((r) => r.privilege_type);
  check("service_role on events = INSERT+SELECT only", JSON.stringify(evPrivs) === JSON.stringify(["INSERT", "SELECT"]), JSON.stringify(evPrivs));
  const authMemPrivs = (await c.query(`select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='jarvis_memories' and grantee='authenticated' order by 1`)).rows.map((r) => r.privilege_type);
  check("authenticated on memories = SELECT only", JSON.stringify(authMemPrivs) === JSON.stringify(["SELECT"]), JSON.stringify(authMemPrivs));

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0064 JARVIS MEMORY: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
