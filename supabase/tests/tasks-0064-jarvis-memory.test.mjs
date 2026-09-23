/**
 * Bbettr OS — Migration 0064 (Jarvis Memory V1) DB security proof.
 *
 * Applies REAL 0062 (grants) THEN 0064 on a minimal agency scaffold and proves:
 *   - CAPABILITY-DRIVEN reads: internal identity + effective memory.read reads
 *     shared (agency/client) memory; an internal user WITHOUT memory.read cannot
 *     read shared memory (admin status alone is NOT authorization); user-scoped
 *     memory is owner-isolated; clients/reps are denied EVEN WITH a mistaken
 *     grant row; cross-workspace denied.
 *   - jarvis_memory_events: append-only + FK carve-out (unchanged discipline).
 *   - ATOMIC RPCs: confirm/retire/flag_conflict/supersede mutate row + write
 *     lineage together, or not at all (a failed precondition writes NOTHING).
 *   - conflicts are MANY-TO-MANY (a memory may be in several conflicts).
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
  admin: "00000000-0000-0000-0000-0000000000a1",   // admin WS + bundle:founder
  admin2: "00000000-0000-0000-0000-0000000000a2",   // admin WS2 + memory.read (in WS2)
  reader: "00000000-0000-0000-0000-0000000000a3",   // admin WS + raw memory.read
  nogrant: "00000000-0000-0000-0000-0000000000a4",  // admin WS + NO grant
  client: "00000000-0000-0000-0000-0000000000c9",   // client, no grant
  clientg: "00000000-0000-0000-0000-0000000000c8",  // client + MISTAKEN memory.read
  rep: "00000000-0000-0000-0000-0000000000f1",       // rep + MISTAKEN memory.read
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
  ('${U.admin}','a@t'),('${U.admin2}','a2@t'),('${U.reader}','r@t'),('${U.nogrant}','n@t'),
  ('${U.client}','c@t'),('${U.clientg}','cg@t'),('${U.rep}','rep@t');
insert into public.profiles (id,role,client_id,workspace_id) values
  ('${U.admin}','admin',null,'${WS}'),
  ('${U.admin2}','admin',null,'${WS2}'),
  ('${U.reader}','admin',null,'${WS}'),
  ('${U.nogrant}','admin',null,'${WS}'),
  ('${U.client}','client','${CL}',null),
  ('${U.clientg}','client','${CL}',null),
  ('${U.rep}','rep',null,null);
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
const idsOf = (r) => r.rows.map((x) => x.id);

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0062_jarvis_foundation.sql"), "utf8"));
  await c.query(readFileSync(join(MIG, "0064_jarvis_memory.sql"), "utf8"));

  // Grants (service-role write path = superuser here).
  await c.query(`insert into public.jarvis_capability_grants (workspace_id,subject_user_id,grant_key) values
    ('${WS}','${U.admin}','bundle:founder'),
    ('${WS}','${U.reader}','memory.read'),
    ('${WS2}','${U.admin2}','memory.read'),
    ('${WS}','${U.clientg}','memory.read'),   -- MISTAKEN grant on a client
    ('${WS}','${U.rep}','memory.read')`);      // MISTAKEN grant on a rep

  // Seed memories.
  const mem = async (scope, extra) => (await c.query(
    `insert into public.jarvis_memories (workspace_id,scope,category,claim,source_kind,state,current${extra.cols}) values ('${WS}','${scope}','${extra.cat}','${extra.claim}','human_statement','${extra.state}',${extra.current}${extra.vals}) returning id`
  )).rows[0].id;
  const memAgency = await mem("agency", { cols: "", vals: "", cat: "company_knowledge", claim: "Agency SOP", state: "confirmed", current: true });
  const memClient = await mem("client", { cols: ",client_id", vals: `,'${CL}'`, cat: "client_knowledge", claim: "Client context", state: "confirmed", current: true });
  const memUserNo = await mem("user", { cols: ",user_id", vals: `,'${U.nogrant}'`, cat: "preference_rule", claim: "nogrant pref", state: "confirmed", current: true });
  const memUserRd = await mem("user", { cols: ",user_id", vals: `,'${U.reader}'`, cat: "preference_rule", claim: "reader pref", state: "confirmed", current: true });
  const memProposed = await mem("agency", { cols: "", vals: "", cat: "context_note", claim: "candidate", state: "proposed", current: false });

  console.log("── structure ──");
  check("jarvis_memories RLS on", (await scalar(c, `select relrowsecurity from pg_class where oid='public.jarvis_memories'::regclass`)) === true);
  check("jarvis_memory_conflicts exists", (await scalar(c, `select to_regclass('public.jarvis_memory_conflicts') is not null`)) === true);
  check("jarvis_memory_events force-RLS + trigger", (await scalar(c, `select relforcerowsecurity from pg_class where oid='public.jarvis_memory_events'::regclass`)) === true && (await scalar(c, `select count(*)::int from pg_trigger where tgname='jarvis_memory_events_no_mutation'`)) === 1);
  check("helpers + atomic RPCs present", (await scalar(c, `select count(*)::int from pg_proc where proname in ('jarvis_is_internal','jarvis_can_read_memory','jarvis_memory_create','jarvis_memory_confirm','jarvis_memory_retire','jarvis_memory_flag_conflict','jarvis_memory_supersede')`)) === 7);

  console.log("\n── CONCERN 1: capability-driven shared reads ──");
  // shared = memAgency + memClient + memProposed (agency, not-current) = 3.
  const founder = await runAs(c, "authenticated", U.admin, `select id from public.jarvis_memories where scope in ('agency','client')`);
  check("founder (internal + bundle:founder) reads shared agency+client (3)", founder.rowCount === 3);
  const reader = await runAs(c, "authenticated", U.reader, `select id from public.jarvis_memories where scope in ('agency','client')`);
  check("internal + raw memory.read reads shared (3)", reader.rowCount === 3);
  const readerOwn = await runAs(c, "authenticated", U.reader, `select id from public.jarvis_memories where id='${memUserRd}'`);
  check("owner may read their OWN user-scoped memory", readerOwn.rowCount === 1);
  const nograntShared = await runAs(c, "authenticated", U.nogrant, `select id from public.jarvis_memories where scope in ('agency','client')`);
  check("internal WITHOUT memory.read CANNOT read shared (admin≠authorization)", nograntShared.rowCount === 0);
  const nograntOwn = await runAs(c, "authenticated", U.nogrant, `select id from public.jarvis_memories`);
  check("internal WITHOUT grant still reads only their OWN user-scoped row (1)", nograntOwn.rowCount === 1 && idsOf(nograntOwn)[0] === memUserNo);
  const readerSeesOther = await runAs(c, "authenticated", U.reader, `select id from public.jarvis_memories where id='${memUserNo}'`);
  check("user-scoped memory is owner-isolated (memory.read holder cannot read another's)", readerSeesOther.rowCount === 0);

  console.log("\n── CONCERN 1: clients/reps denied even WITH a mistaken grant ──");
  check("client (no grant) denied", denied(await runAs(c, "authenticated", U.client, `select id from public.jarvis_memories`)));
  check("client WITH mistaken memory.read STILL denied", (await runAs(c, "authenticated", U.clientg, `select id from public.jarvis_memories`)).rowCount === 0);
  check("rep WITH mistaken memory.read STILL denied", (await runAs(c, "authenticated", U.rep, `select id from public.jarvis_memories`)).rowCount === 0);
  check("anon denied", denied(await runAs(c, "anon", null, `select id from public.jarvis_memories`)));
  check("authenticated cannot directly WRITE memory (service-role only)", (await runAs(c, "authenticated", U.admin, `insert into public.jarvis_memories (workspace_id,scope,category,claim,source_kind) values ('${WS}','agency','context_note','x','human_statement')`)).error !== null);
  check("cross-workspace: admin2 (grant in WS2) sees no WS memory", (await runAs(c, "authenticated", U.admin2, `select id from public.jarvis_memories`)).rowCount === 0);

  console.log("\n── append-only events + FK carve-out ──");
  await c.query(`insert into public.jarvis_memory_events (workspace_id,memory_id,event_type,actor_kind,actor_user_id,actor_display,reason) values ('${WS}','${memAgency}','created','human','${U.nogrant}','N','seed')`);
  const EID = (await c.query(`select event_id from public.jarvis_memory_events limit 1`)).rows[0].event_id;
  check("founder reads memory events (memory.read)", (await runAs(c, "authenticated", U.admin, `select event_id from public.jarvis_memory_events`)).rowCount === 1);
  check("client denied events", denied(await runAs(c, "authenticated", U.client, `select event_id from public.jarvis_memory_events`)));
  check("authenticated cannot insert events (service-role only)", (await runAs(c, "authenticated", U.admin, `insert into public.jarvis_memory_events (workspace_id,event_type,actor_kind) values ('${WS}','created','human')`)).error !== null);
  check("ordinary UPDATE rejected", !(await tryQ(c, `update public.jarvis_memory_events set reason='x' where event_id='${EID}'`)).ok);
  check("DELETE rejected", !(await tryQ(c, `delete from public.jarvis_memory_events where event_id='${EID}'`)).ok);
  check("carve-out: deleting referenced profile nullifies actor_user_id, rest intact", (await tryQ(c, `delete from public.profiles where id='${U.nogrant}'`)).ok && (await scalar(c, `select actor_user_id is null and reason='seed' from public.jarvis_memory_events where event_id='${EID}'`)) === true);

  console.log("\n── CONCERN 2: atomic row + lineage (all-or-nothing) ──");
  // Wrong guard → RPC returns false, NOTHING changes (no state change, no event).
  const eventsBefore = await scalar(c, `select count(*)::int from public.jarvis_memory_events where memory_id='${memProposed}' and event_type='confirmed'`);
  const wrongGuard = (await c.query(`select public.jarvis_memory_confirm('${WS}','${memProposed}','observed','${U.admin}','A') as ok`)).rows[0].ok;
  const stateAfterWrong = await scalar(c, `select state from public.jarvis_memories where id='${memProposed}'`);
  const eventsAfterWrong = await scalar(c, `select count(*)::int from public.jarvis_memory_events where memory_id='${memProposed}' and event_type='confirmed'`);
  check("confirm with wrong guard → false, state unchanged, NO event written", wrongGuard === false && stateAfterWrong === "proposed" && eventsAfterWrong === eventsBefore);
  // Correct guard → row + event together.
  const rightGuard = (await c.query(`select public.jarvis_memory_confirm('${WS}','${memProposed}','proposed','${U.admin}','A') as ok`)).rows[0].ok;
  check("confirm with correct guard → true, confirmed + exactly one 'confirmed' event", rightGuard === true && (await scalar(c, `select state from public.jarvis_memories where id='${memProposed}'`)) === "confirmed" && (await scalar(c, `select count(*)::int from public.jarvis_memory_events where memory_id='${memProposed}' and event_type='confirmed'`)) === 1);
  // flag_conflict with a non-existent memory → raises; NO edges, NO events persist.
  const badId = "00000000-0000-0000-0000-0000000000bb";
  const badFlag = await tryQ(c, `select public.jarvis_memory_flag_conflict('${WS}','${memAgency}','${badId}','${U.admin}','A','r')`);
  check("flag_conflict with missing memory → rejected, no partial edges/events", !badFlag.ok && (await scalar(c, `select count(*)::int from public.jarvis_memory_conflicts where memory_id='${memAgency}'`)) === 0 && (await scalar(c, `select count(*)::int from public.jarvis_memory_events where memory_id='${memAgency}' and event_type='conflict_flagged'`)) === 0);
  // supersede an already-superseded memory → raises, no extra row.
  const newId = (await c.query(`select public.jarvis_memory_supersede('${WS}','${memClient}', '{"scope":"client","client_id":"${CL}","category":"client_knowledge","claim":"updated","source_kind":"human_statement"}'::jsonb,'${U.admin}','A','fix') as id`)).rows[0].id;
  const memCountBefore = await scalar(c, `select count(*)::int from public.jarvis_memories`);
  const reSupersede = await tryQ(c, `select public.jarvis_memory_supersede('${WS}','${memClient}', '{"scope":"client","client_id":"${CL}","category":"client_knowledge","claim":"x","source_kind":"human_statement"}'::jsonb,'${U.admin}','A','again')`);
  check("supersede already-superseded → rejected, NO new row created", !reSupersede.ok && (await scalar(c, `select count(*)::int from public.jarvis_memories`)) === memCountBefore);
  check("supersession preserved history (old superseded→new, new supersedes→old)", (await scalar(c, `select state='superseded' and current=false and superseded_by_id='${newId}' from public.jarvis_memories where id='${memClient}'`)) === true && (await scalar(c, `select state='confirmed' and current=true and supersedes_id='${memClient}' from public.jarvis_memories where id='${newId}'`)) === true);

  console.log("\n── CONCERN 3: conflicts are many-to-many ──");
  await c.query(`select public.jarvis_memory_flag_conflict('${WS}','${memAgency}','${newId}','${U.admin}','A','c1')`);
  await c.query(`select public.jarvis_memory_flag_conflict('${WS}','${memAgency}','${memProposed}','${U.admin}','A','c2')`);
  check("one memory participates in TWO simultaneous conflicts", (await scalar(c, `select count(*)::int from public.jarvis_memory_conflicts where memory_id='${memAgency}' and resolved_at is null`)) === 2);
  check("re-flagging the same pair is idempotent (no duplicate edge)", (await tryQ(c, `select public.jarvis_memory_flag_conflict('${WS}','${memAgency}','${newId}','${U.admin}','A','again')`)).ok && (await scalar(c, `select count(*)::int from public.jarvis_memory_conflicts where memory_id='${memAgency}' and other_memory_id='${newId}'`)) === 1);

  console.log("\n── privileges ──");
  const evPrivs = (await c.query(`select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='jarvis_memory_events' and grantee='service_role' order by 1`)).rows.map((r) => r.privilege_type);
  check("service_role on events = INSERT+SELECT only", JSON.stringify(evPrivs) === JSON.stringify(["INSERT", "SELECT"]), JSON.stringify(evPrivs));
  check("authenticated on memories = SELECT only", JSON.stringify((await c.query(`select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='jarvis_memories' and grantee='authenticated' order by 1`)).rows.map((r) => r.privilege_type)) === JSON.stringify(["SELECT"]));
  check("atomic RPC execute is service_role only (not PUBLIC/authenticated)", (await scalar(c, `select has_function_privilege('authenticated','public.jarvis_memory_confirm(uuid,uuid,text,uuid,text)','execute')`)) === false);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0064 JARVIS MEMORY: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
