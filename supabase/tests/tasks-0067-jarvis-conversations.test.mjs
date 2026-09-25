/**
 * Bbettr OS — Migration 0067 (Jarvis Intelligence v1, Slice A: conversations) proof.
 *
 * Reproduces Supabase default privileges, applies 0062 + 0064 (deps: is_admin,
 * jarvis_is_internal, jarvis_capability_grants) then 0067, and proves:
 *   SCHEMA: tables/constraints/helpers/trigger exist; role+status CHECKs.
 *   PRIVILEGES: anon none; authenticated SELECT-only; service_role threads
 *     S/I/U (no D); messages I/S (no U/D); helper EXECUTE least-privilege.
 *   RLS: owner-only — owner reads own thread+messages; another jarvis-enabled
 *     admin, an internal user WITHOUT jarvis.use, clients, reps, and cross-
 *     workspace are all denied. jarvis.use enforced in DB (defense-in-depth).
 *   WRITE BOUNDARY: authenticated cannot write; service_role writes only intended.
 *   APPEND-ONLY: message UPDATE/DELETE rejected; owner-profile deletion cascades
 *     (thread removed, message thread_id SET NULL via carve-out — not blocked).
 *   LIFECYCLE: thread metadata update + archive work; last_client_id set/clear
 *     (client delete → SET NULL) never leaks access or breaks integrity.
 *   DEFAULT-PRIV REGRESSION: a probe table shows defaults ARE active; 0067 tables
 *     do not carry them.
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
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("0067: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1";
const WS2 = "00000000-0000-0000-0000-0000000000e2";
const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",  // admin WS + bundle:founder (jarvis.use) — owns the thread
  other: "00000000-0000-0000-0000-0000000000a2",  // admin WS + bundle:founder — jarvis-enabled but NOT owner
  nouse: "00000000-0000-0000-0000-0000000000a3",  // admin WS + NO grant — internal but no jarvis.use
  admin2: "00000000-0000-0000-0000-0000000000a4", // admin WS2 + bundle:founder (in WS2) — cross-workspace
  client: "00000000-0000-0000-0000-0000000000c9", // client
  rep: "00000000-0000-0000-0000-0000000000f1",     // rep + mistaken jarvis.use grant
};
const CL = "00000000-0000-0000-0000-0000000000ca";

const SCAFFOLD = `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
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
  ('${U.owner}','o@t'),('${U.other}','ot@t'),('${U.nouse}','nu@t'),('${U.admin2}','a2@t'),('${U.client}','c@t'),('${U.rep}','r@t');
insert into public.profiles (id,role,client_id,workspace_id) values
  ('${U.owner}','admin',null,'${WS}'),
  ('${U.other}','admin',null,'${WS}'),
  ('${U.nouse}','admin',null,'${WS}'),
  ('${U.admin2}','admin',null,'${WS2}'),
  ('${U.client}','client','${CL}',null),
  ('${U.rep}','rep',null,null);
-- probe table to prove Supabase default privileges ARE active in this test env
create table public._defaults_probe (id int);
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
const fpriv = (c, role, fn) => scalar(c, `select has_function_privilege('${role}','public.${fn}','execute')`);

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0062_jarvis_foundation.sql"), "utf8"));
  await c.query(readFileSync(join(MIG, "0064_jarvis_memory.sql"), "utf8"));
  await c.query(readFileSync(join(MIG, "0067_jarvis_conversations.sql"), "utf8"));

  console.log("── structure ──");
  check("jarvis_threads exists", (await scalar(c, `select to_regclass('public.jarvis_threads') is not null`)) === true);
  check("jarvis_messages force-RLS", (await scalar(c, `select relforcerowsecurity from pg_class where oid='public.jarvis_messages'::regclass`)) === true);
  check("append-only trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='jarvis_messages_no_mutation'`)) === 1);
  check("helpers present (jarvis_has_use, jarvis_can_read_thread)", (await scalar(c, `select count(*)::int from pg_proc where proname in ('jarvis_has_use','jarvis_can_read_thread')`)) === 2);
  check("role CHECK rejects a non user/assistant role", !(await tryQ(c, `insert into public.jarvis_messages (thread_id,workspace_id,role,content) values (null,'${WS}','system','x')`)).ok);
  check("status CHECK rejects unknown status", !(await tryQ(c, `insert into public.jarvis_messages (thread_id,workspace_id,role,content,status) values (null,'${WS}','user','x','weird')`)).ok);
  check("thread_id is NOT NULL (a message must belong to a thread)", !(await tryQ(c, `insert into public.jarvis_messages (workspace_id,role,content) values ('${WS}','user','x')`)).ok);

  console.log("\n── PROVEN PostgreSQL behavior: BEFORE DELETE trigger vs FK cascade ──");
  await c.query(`create table public._casc_parent (id int primary key)`);
  await c.query(`create table public._casc_child (id int primary key, p int references public._casc_parent(id) on delete cascade)`);
  await c.query(`create function public._casc_reject() returns trigger language plpgsql as $fn$ begin raise exception 'append-only'; end $fn$`);
  await c.query(`create trigger _casc_no_del before delete on public._casc_child for each row execute function public._casc_reject()`);
  await c.query(`insert into public._casc_parent values (1); insert into public._casc_child values (10,1)`);
  check("a BEFORE DELETE reject trigger BLOCKS parent FK cascade (so we do NOT use one)", !(await tryQ(c, `delete from public._casc_parent where id=1`)).ok);
  check("...child row survived (cascade rolled back)", (await scalar(c, `select count(*)::int from public._casc_child`)) === 1);
  await c.query(`drop table public._casc_child; drop table public._casc_parent; drop function public._casc_reject()`);

  console.log("\n── default-privilege regression ──");
  check("probe table shows Supabase defaults ARE active (anon INSERT on probe)", (await tpriv(c, "anon", "_defaults_probe", "INSERT")) === true);
  check("0067 threads did NOT inherit defaults (anon no INSERT)", (await tpriv(c, "anon", "jarvis_threads", "INSERT")) === false);

  console.log("\n── table ACLs ──");
  for (const t of ["jarvis_threads", "jarvis_messages"]) {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) check(`anon has NO ${p} on ${t}`, (await tpriv(c, "anon", t, p)) === false);
    check(`authenticated SELECT on ${t}`, (await tpriv(c, "authenticated", t, "SELECT")) === true);
    for (const p of ["INSERT", "UPDATE", "DELETE"]) check(`authenticated has NO ${p} on ${t}`, (await tpriv(c, "authenticated", t, p)) === false);
  }
  check("service_role threads: SELECT+INSERT+UPDATE, NO DELETE", (await tpriv(c, "service_role", "jarvis_threads", "INSERT")) === true && (await tpriv(c, "service_role", "jarvis_threads", "UPDATE")) === true && (await tpriv(c, "service_role", "jarvis_threads", "DELETE")) === false);
  check("service_role messages: INSERT+SELECT only", (await tpriv(c, "service_role", "jarvis_messages", "INSERT")) === true && (await tpriv(c, "service_role", "jarvis_messages", "SELECT")) === true && (await tpriv(c, "service_role", "jarvis_messages", "UPDATE")) === false && (await tpriv(c, "service_role", "jarvis_messages", "DELETE")) === false);

  console.log("\n── helper/function EXECUTE ACLs ──");
  for (const fn of ["jarvis_has_use()", "jarvis_can_read_thread(uuid)"]) {
    check(`${fn.split("(")[0]}: authenticated=true, service_role=true, anon=false`,
      (await fpriv(c, "authenticated", fn)) === true && (await fpriv(c, "service_role", fn)) === true && (await fpriv(c, "anon", fn)) === false);
  }
  check("jarvis_messages_reject_mutation NOT executable by authenticated/anon", (await fpriv(c, "authenticated", "jarvis_messages_reject_mutation()")) === false && (await fpriv(c, "anon", "jarvis_messages_reject_mutation()")) === false);

  // grants + thread + messages (service-role write path = superuser here).
  await c.query(`insert into public.jarvis_capability_grants (workspace_id,subject_user_id,grant_key) values
    ('${WS}','${U.owner}','bundle:founder'),
    ('${WS}','${U.other}','bundle:founder'),
    ('${WS2}','${U.admin2}','bundle:founder'),
    ('${WS}','${U.rep}','jarvis.use')`);   // mistaken grant on a rep
  const TH = (await c.query(`insert into public.jarvis_threads (workspace_id,user_id,title) values ('${WS}','${U.owner}','Test thread') returning id`)).rows[0].id;
  const THnouse = (await c.query(`insert into public.jarvis_threads (workspace_id,user_id,title) values ('${WS}','${U.nouse}','nouse thread') returning id`)).rows[0].id;
  const M1 = (await c.query(`insert into public.jarvis_messages (thread_id,workspace_id,role,content) values ('${TH}','${WS}','user','hi') returning id`)).rows[0].id;
  await c.query(`insert into public.jarvis_messages (thread_id,workspace_id,role,content,status) values ('${TH}','${WS}','assistant','hello','ok')`);

  console.log("\n── owner-only RLS ──");
  check("owner reads own thread", (await runAs(c, "authenticated", U.owner, `select id from public.jarvis_threads where id='${TH}'`)).rowCount === 1);
  check("owner reads own messages", (await runAs(c, "authenticated", U.owner, `select id from public.jarvis_messages where thread_id='${TH}'`)).rowCount === 2);
  check("another jarvis-enabled admin CANNOT read owner's thread", (await runAs(c, "authenticated", U.other, `select id from public.jarvis_threads where id='${TH}'`)).rowCount === 0);
  check("another jarvis-enabled admin CANNOT read owner's messages", (await runAs(c, "authenticated", U.other, `select id from public.jarvis_messages where thread_id='${TH}'`)).rowCount === 0);
  check("internal admin WITHOUT jarvis.use CANNOT read own thread (defense-in-depth)", (await runAs(c, "authenticated", U.nouse, `select id from public.jarvis_threads where id='${THnouse}'`)).rowCount === 0);
  check("client denied threads", denied(await runAs(c, "authenticated", U.client, `select id from public.jarvis_threads`)));
  check("rep WITH mistaken jarvis.use grant STILL denied (not internal)", (await runAs(c, "authenticated", U.rep, `select id from public.jarvis_threads`)).rowCount === 0);
  check("cross-workspace admin denied", (await runAs(c, "authenticated", U.admin2, `select id from public.jarvis_threads`)).rowCount === 0);
  check("anon denied threads/messages", denied(await runAs(c, "anon", null, `select id from public.jarvis_threads`)) && denied(await runAs(c, "anon", null, `select id from public.jarvis_messages`)));

  console.log("\n── write boundary ──");
  check("authenticated CANNOT insert thread", (await runAs(c, "authenticated", U.owner, `insert into public.jarvis_threads (workspace_id,user_id) values ('${WS}','${U.owner}')`)).error !== null);
  check("authenticated CANNOT update thread", (await runAs(c, "authenticated", U.owner, `update public.jarvis_threads set title='x' where id='${TH}'`)).error !== null);
  check("authenticated CANNOT insert message", (await runAs(c, "authenticated", U.owner, `insert into public.jarvis_messages (thread_id,workspace_id,role,content) values ('${TH}','${WS}','user','x')`)).error !== null);
  check("service_role CAN insert thread + message", (await runAs(c, "service_role", null, `insert into public.jarvis_threads (workspace_id,user_id) values ('${WS}','${U.owner}')`)).error === null && (await runAs(c, "service_role", null, `insert into public.jarvis_messages (thread_id,workspace_id,role,content) values ('${TH}','${WS}','user','x')`)).error === null);
  check("service_role CANNOT delete thread (archive-preferred)", (await runAs(c, "service_role", null, `delete from public.jarvis_threads where id='${TH}'`)).error !== null);

  console.log("\n── append-only (UPDATE immutable; direct delete blocked by privilege) ──");
  check("direct message UPDATE rejected by trigger (even superuser)", !(await tryQ(c, `update public.jarvis_messages set content='tampered' where id='${M1}'`)).ok);
  check("service_role cannot UPDATE messages (privilege)", (await runAs(c, "service_role", null, `update public.jarvis_messages set content='x' where id='${M1}'`)).error !== null);
  check("service_role cannot DELETE messages (privilege)", (await runAs(c, "service_role", null, `delete from public.jarvis_messages where id='${M1}'`)).error !== null);
  check("authenticated cannot DELETE messages (privilege)", (await runAs(c, "authenticated", U.owner, `delete from public.jarvis_messages where id='${M1}'`)).error !== null);

  console.log("\n── parent cascade removes messages (no orphans; append-only trigger does NOT block it) ──");
  const TH2 = (await c.query(`insert into public.jarvis_threads (workspace_id,user_id,title) values ('${WS}','${U.owner}','cascade thread') returning id`)).rows[0].id;
  await c.query(`insert into public.jarvis_messages (thread_id,workspace_id,role,content) values ('${TH2}','${WS}','user','x'),('${TH2}','${WS}','assistant','y')`);
  check("thread has messages before delete", (await scalar(c, `select count(*)::int from public.jarvis_messages where thread_id='${TH2}'`)) === 2);
  const cascDel = await tryQ(c, `delete from public.jarvis_threads where id='${TH2}'`);
  check("trusted thread deletion SUCCEEDS via cascade", cascDel.ok, cascDel.error?.message);
  check("child messages cascade-deleted (no orphans)", (await scalar(c, `select count(*)::int from public.jarvis_messages where thread_id='${TH2}'`)) === 0);

  console.log("\n── thread lifecycle ──");
  check("service_role thread metadata update (title/status/last_client_id/archived_at)", (await tryQ(c, `update public.jarvis_threads set title='T2', status='archived', last_client_id='${CL}', archived_at=now(), updated_at=now() where id='${TH}'`)).ok);
  check("deleting the referenced client clears last_client_id (SET NULL, no error, no leak)", (await tryQ(c, `delete from public.clients where id='${CL}'`)).ok && (await scalar(c, `select last_client_id is null from public.jarvis_threads where id='${TH}'`)) === true);
  check("thread still readable by owner after client cleared", (await runAs(c, "authenticated", U.owner, `select id from public.jarvis_threads where id='${TH}'`)).rowCount === 1);

  console.log("\n── owner profile deletion cascades (thread + messages; NO orphans) ──");
  const delOwner = await tryQ(c, `delete from public.profiles where id='${U.owner}'`);
  check("deleting owner profile SUCCEEDS (cascade)", delOwner.ok, delOwner.error?.message);
  check("owner threads removed", (await scalar(c, `select count(*)::int from public.jarvis_threads where user_id='${U.owner}'`)) === 0);
  check("owner messages removed (M1 gone — no orphan)", (await scalar(c, `select count(*)::int from public.jarvis_messages where id='${M1}'`)) === 0);
  check("NO orphan messages exist anywhere (every message still has a thread)", (await scalar(c, `select count(*)::int from public.jarvis_messages m left join public.jarvis_threads t on t.id = m.thread_id where t.id is null`)) === 0);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0067 JARVIS CONVERSATIONS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
