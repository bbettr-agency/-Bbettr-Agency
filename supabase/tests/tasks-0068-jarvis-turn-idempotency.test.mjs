// ============================================================================
// tasks-0068 — JARVIS INTELLIGENCE V1, Slice F1a: transport idempotency
// primitives (jarvis_turns + Memory idempotency). Disposable-Postgres proof.
//
// Applies the full Jarvis DB stack (0062–0068) to a throwaway database and proves
// schema, ledger invariants (immutable / STRICT set-once / monotonic-terminal /
// state-coherence / lease / updated_at), RLS/ACLs, that the linkage columns are
// PLAIN uuid audit pointers (no FK), hash-hex enforcement, and the
// idempotency-aware jarvis_memory_create (replay / conflict / event honesty /
// concurrency), plus that exactly one jarvis_memory_create signature remains.
//
//   TEST_DATABASE_URL must point at a disposable DB whose name contains "test".
// ============================================================================
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
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("0068: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1";
const WS2 = "00000000-0000-0000-0000-0000000000e2";
const U = {
  owner: "00000000-0000-0000-0000-0000000000a1",
  other: "00000000-0000-0000-0000-0000000000a2",
  nouse: "00000000-0000-0000-0000-0000000000a3",
  admin2: "00000000-0000-0000-0000-0000000000a4",
  client: "00000000-0000-0000-0000-0000000000c9",
  rep: "00000000-0000-0000-0000-0000000000f1",
  del: "00000000-0000-0000-0000-0000000000a5",
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
  ('${U.owner}','o@t'),('${U.other}','ot@t'),('${U.nouse}','nu@t'),('${U.admin2}','a2@t'),('${U.client}','c@t'),('${U.rep}','r@t'),('${U.del}','d@t');
insert into public.profiles (id,role,client_id,workspace_id) values
  ('${U.owner}','admin',null,'${WS}'),('${U.other}','admin',null,'${WS}'),('${U.nouse}','admin',null,'${WS}'),
  ('${U.admin2}','admin',null,'${WS2}'),('${U.client}','client','${CL}',null),('${U.rep}','rep',null,null),('${U.del}','admin',null,'${WS}');
create table public._defaults_probe (id int);
`;

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d && !ok ? "  — " + d : ""}`); ok ? pass++ : fail++; };
async function scalar(c, sql, p = []) { const { rows } = await c.query(sql, p); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function tryQ(c, sql, p = []) { try { const r = await c.query(sql, p); return { ok: true, rowCount: r.rowCount ?? 0, rows: r.rows }; } catch (e) { return { ok: false, error: e }; } }
const rejected = (r, code) => r.ok === false && (code ? r.error?.code === code : true);
async function runAs(c, role, uid, sql, p = []) {
  try { await c.query("begin"); await c.query(`set local role ${role}`); await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]); const r = await c.query(sql, p); await c.query("rollback"); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const tpriv = (c, role, tbl, priv) => scalar(c, `select has_table_privilege('${role}','public.${tbl}','${priv}')`);
const fpriv = (c, role, fn) => scalar(c, `select has_function_privilege('${role}','public.${fn}','execute')`);

const HEX = "a".repeat(64), UPPER = "A".repeat(64), SHORT = "a".repeat(63), LONG = "a".repeat(65), NONHEX = "z".repeat(64);
const KEY = (n) => `turn:00000000-0000-0000-0000-0000000000${n}:memory:0`;
const MEMROW = (claim = "we bill monthly") => JSON.stringify({ scope: "agency", category: "company_knowledge", claim, state: "inferred", current: false, source_kind: "model_inference" });
const memCreate = (c, key, hash, claim) => c.query(`select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5,$6,$7) as id`, [WS, MEMROW(claim), U.owner, "Owner", "test", key, hash]);
async function newTurn(c) {
  return scalar(c, `insert into public.jarvis_turns (workspace_id,user_id,idempotency_key,request_hash,correlation_id,lease_expires_at)
    values ($1,$2,gen_random_uuid(),$3,gen_random_uuid(), now() + interval '10 min') returning id`, [WS, U.owner, HEX]);
}

async function main() {
  assertDisposableTarget();
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test";
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const m of ["0062_jarvis_foundation.sql", "0063_jarvis_action_events_fk_carveout.sql", "0064_jarvis_memory.sql", "0065_jarvis_memory_privilege_hardening.sql", "0066_jarvis_foundation_privilege_hardening.sql", "0067_jarvis_conversations.sql", "0068_jarvis_turn_idempotency.sql"]) {
    await c.query(readFileSync(join(MIG, m), "utf8"));
  }
  await c.query(`insert into public.jarvis_capability_grants (workspace_id,subject_user_id,grant_key) values
    ('${WS}','${U.owner}','bundle:founder'),('${WS}','${U.other}','bundle:founder'),('${WS2}','${U.admin2}','bundle:founder')`);

  // ── schema ──
  console.log("── jarvis_turns schema ──");
  check("1 jarvis_turns exists", (await scalar(c, `select to_regclass('public.jarvis_turns') is not null`)) === true);
  check("2 unique(workspace,user,idempotency_key)", (await scalar(c, `select count(*)::int from pg_constraint where conname='jarvis_turns_idem_unique' and contype='u'`)) === 1);
  check("3 indexes exist (owner + stale-partial)", (await scalar(c, `select count(*)::int from pg_indexes where tablename='jarvis_turns' and indexname in ('jarvis_turns_owner_idx','jarvis_turns_stale_idx')`)) === 2);

  // ── linkage columns are PLAIN uuid (NO FK) — Option E ──
  console.log("\n── linkage columns: no FK (audit pointers) ──");
  check("4 exactly 2 FKs on jarvis_turns (user_id, workspace_id)", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.jarvis_turns'::regclass and contype='f'`)) === 2);
  check("5 NO FK from jarvis_turns to threads/messages/proposals/memories", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.jarvis_turns'::regclass and contype='f' and confrelid in ('public.jarvis_threads'::regclass,'public.jarvis_messages'::regclass,'public.jarvis_proposals'::regclass,'public.jarvis_memories'::regclass)`)) === 0);
  check("6 user_id FK is ON DELETE CASCADE", (await scalar(c, `select confdeltype from pg_constraint where conrelid='public.jarvis_turns'::regclass and contype='f' and confrelid='public.profiles'::regclass`)) === "c");

  // ── hash hex enforcement ──
  console.log("\n── request_hash SHA-256 hex ──");
  const insHash = (h) => tryQ(c, `insert into public.jarvis_turns (workspace_id,user_id,idempotency_key,request_hash,correlation_id,lease_expires_at) values ('${WS}','${U.owner}',gen_random_uuid(),$1,gen_random_uuid(),now()+interval '1 min')`, [h]);
  check("7 valid lowercase 64-hex accepted", (await insHash(HEX)).ok);
  check("8 63 chars rejected", rejected(await insHash(SHORT)));
  check("9 65 chars rejected", rejected(await insHash(LONG)));
  check("10 non-hex 64 rejected", rejected(await insHash(NONHEX)));
  check("11 uppercase hex rejected", rejected(await insHash(UPPER)));

  // ── lease invariant ──
  console.log("\n── lease invariant ──");
  const insLease = (expr) => tryQ(c, `insert into public.jarvis_turns (workspace_id,user_id,idempotency_key,request_hash,correlation_id,created_at,lease_expires_at) values ('${WS}','${U.owner}',gen_random_uuid(),'${HEX}',gen_random_uuid(), now(), ${expr})`);
  check("12 lease later than created accepted", (await insLease("now()+interval '5 min'")).ok);
  check("13 lease equal to created rejected", rejected(await insLease("now()")));
  check("14 lease earlier than created rejected", rejected(await insLease("now()-interval '1 min'")));

  // ── mutation invariants ──
  console.log("\n── mutation invariants ──");
  const t1 = await newTurn(c);
  check("15 immutable workspace_id", rejected(await tryQ(c, `update public.jarvis_turns set workspace_id='${WS2}' where id='${t1}'`), "BB68I"));
  check("16 immutable idempotency_key", rejected(await tryQ(c, `update public.jarvis_turns set idempotency_key=gen_random_uuid() where id='${t1}'`), "BB68I"));
  check("17 immutable request_hash", rejected(await tryQ(c, `update public.jarvis_turns set request_hash='${"b".repeat(64)}' where id='${t1}'`), "BB68I"));
  check("18 immutable lease_expires_at", rejected(await tryQ(c, `update public.jarvis_turns set lease_expires_at=now()+interval '1 day' where id='${t1}'`), "BB68I"));

  // ── linkage strict set-once ──
  console.log("\n── linkage strict set-once (no clear, no repoint) ──");
  const cols = ["thread_id", "user_message_id", "assistant_message_id", "proposal_id", "memory_id"];
  for (const col of cols) {
    const t = await newTurn(c);
    check(`19.${col} NULL→uuid accepted`, (await tryQ(c, `update public.jarvis_turns set ${col}=gen_random_uuid() where id='${t}'`)).ok);
    check(`20.${col} uuid→different rejected`, rejected(await tryQ(c, `update public.jarvis_turns set ${col}=gen_random_uuid() where id='${t}'`), "BB68S"));
    check(`21.${col} uuid→NULL rejected (no clear bypass)`, rejected(await tryQ(c, `update public.jarvis_turns set ${col}=null where id='${t}'`), "BB68S"));
  }

  // ── status monotonic / terminal ──
  console.log("\n── status transitions ──");
  const okC = await newTurn(c); check("22 processing→completed accepted", (await tryQ(c, `update public.jarvis_turns set status='completed', result='{"v":1}'::jsonb, completed_at=now() where id='${okC}'`)).ok);
  check("23 completed is terminal (immutable)", rejected(await tryQ(c, `update public.jarvis_turns set provider_started_at=now() where id='${okC}'`), "BB68T"));
  const okF = await newTurn(c); check("24 processing→failed accepted", (await tryQ(c, `update public.jarvis_turns set status='failed', failure_reason='boom' where id='${okF}'`)).ok);
  check("25 failed is terminal", rejected(await tryQ(c, `update public.jarvis_turns set status='completed', result='{}'::jsonb, completed_at=now() where id='${okF}'`), "BB68T"));
  const okA = await newTurn(c); check("26 processing→abandoned accepted", (await tryQ(c, `update public.jarvis_turns set status='abandoned', failure_reason='stale' where id='${okA}'`)).ok);
  check("27 abandoned is terminal", rejected(await tryQ(c, `update public.jarvis_turns set status='processing' where id='${okA}'`), "BB68T"));

  // ── state coherence ──
  console.log("\n── state coherence ──");
  const insTurn = (extra) => tryQ(c, `insert into public.jarvis_turns (workspace_id,user_id,idempotency_key,request_hash,correlation_id,lease_expires_at,${extra.cols}) values ('${WS}','${U.owner}',gen_random_uuid(),'${HEX}',gen_random_uuid(),now()+interval '1 min',${extra.vals})`);
  check("28 completed without result rejected", rejected(await insTurn({ cols: "status,completed_at", vals: "'completed',now()" })));
  check("29 completed without completed_at rejected", rejected(await insTurn({ cols: "status,result", vals: "'completed','{}'::jsonb" })));
  check("30 valid completed accepted", (await insTurn({ cols: "status,result,completed_at", vals: "'completed','{}'::jsonb,now()" })).ok);
  check("31 processing with result rejected", rejected(await insTurn({ cols: "status,result", vals: "'processing','{}'::jsonb" })));
  check("32 processing with completed_at rejected", rejected(await insTurn({ cols: "status,completed_at", vals: "'processing',now()" })));
  check("33 processing with failure_reason rejected", rejected(await insTurn({ cols: "status,failure_reason", vals: "'processing','x'" })));
  check("34 failed without reason rejected", rejected(await insTurn({ cols: "status", vals: "'failed'" })));
  check("35 blank failed reason rejected", rejected(await insTurn({ cols: "status,failure_reason", vals: "'failed','   '" })));
  check("36 valid failed accepted", (await insTurn({ cols: "status,failure_reason", vals: "'failed','boom'" })).ok);
  check("37 abandoned without reason rejected", rejected(await insTurn({ cols: "status", vals: "'abandoned'" })));
  check("38 valid abandoned accepted", (await insTurn({ cols: "status,failure_reason", vals: "'abandoned','stale'" })).ok);
  check("39 completed WITH failure_reason rejected", rejected(await insTurn({ cols: "status,result,completed_at,failure_reason", vals: "'completed','{}'::jsonb,now(),'x'" })));
  check("40 failed WITH completed_at rejected (completed_at is success-only)", rejected(await insTurn({ cols: "status,failure_reason,completed_at", vals: "'failed','boom',now()" })));

  // ── result byte bound ──
  console.log("\n── result byte bound (octet_length) ──");
  const setResult = async (expr) => { const t = await newTurn(c); return tryQ(c, `update public.jarvis_turns set status='completed', completed_at=now(), result=${expr} where id='${t}'`); };
  check("41 small result accepted", (await setResult(`jsonb_build_object('x','hello')`)).ok);
  check("42 >32KB ascii rejected", rejected(await setResult(`jsonb_build_object('x', repeat('y',40000))`)));
  // multi-byte: 20000 × '€' (3 bytes) = 20000 chars but 60000 bytes → char-based cap would pass, byte-based fails
  const mb = await setResult(`jsonb_build_object('x', repeat(U&'\\20AC',20000))`);
  check("43 multi-byte result proves BYTE bound (char<32768, bytes>32768 rejected)", rejected(mb));

  // ── updated_at ──
  console.log("\n── updated_at ──");
  const tU = await newTurn(c);
  const created = await scalar(c, `select created_at from public.jarvis_turns where id='${tU}'`);
  await c.query(`update public.jarvis_turns set provider_started_at=now() where id='${tU}'`);
  const updated = await scalar(c, `select updated_at from public.jarvis_turns where id='${tU}'`);
  check("44 legitimate mutation advances updated_at", new Date(updated).getTime() >= new Date(created).getTime());
  await c.query(`update public.jarvis_turns set result='{"v":1}'::jsonb, status='completed', completed_at=now(), updated_at='2000-01-01T00:00:00Z' where id='${tU}'`);
  const spoof = await scalar(c, `select extract(year from updated_at)::int from public.jarvis_turns where id='${tU}'`);
  check("45 caller cannot spoof updated_at (overwritten to now())", spoof >= 2025);

  // ── turn security ──
  console.log("\n── jarvis_turns security ──");
  check("46 RLS enabled + FORCE", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.jarvis_turns'::regclass`)) === true);
  const tOwner = await newTurn(c);
  check("47 owner with jarvis.use can SELECT", (await runAs(c, "authenticated", U.owner, `select id from public.jarvis_turns where id='${tOwner}'`)).rowCount === 1);
  check("48 foreign owner cannot SELECT", (await runAs(c, "authenticated", U.other, `select id from public.jarvis_turns where id='${tOwner}'`)).rowCount === 0);
  check("49 wrong workspace cannot SELECT", (await runAs(c, "authenticated", U.admin2, `select id from public.jarvis_turns where id='${tOwner}'`)).rowCount === 0);
  check("50 no jarvis.use cannot SELECT", (await runAs(c, "authenticated", U.nouse, `select id from public.jarvis_turns where id='${tOwner}'`)).rowCount === 0);
  check("51 anon NONE", (await tpriv(c, "anon", "jarvis_turns", "SELECT")) === false && (await tpriv(c, "anon", "jarvis_turns", "INSERT")) === false && (await tpriv(c, "anon", "jarvis_turns", "UPDATE")) === false && (await tpriv(c, "anon", "jarvis_turns", "DELETE")) === false);
  check("52 authenticated SELECT only", (await tpriv(c, "authenticated", "jarvis_turns", "SELECT")) === true && (await tpriv(c, "authenticated", "jarvis_turns", "INSERT")) === false && (await tpriv(c, "authenticated", "jarvis_turns", "UPDATE")) === false && (await tpriv(c, "authenticated", "jarvis_turns", "DELETE")) === false);
  check("53 service_role SELECT/INSERT/UPDATE, no DELETE", (await tpriv(c, "service_role", "jarvis_turns", "SELECT")) === true && (await tpriv(c, "service_role", "jarvis_turns", "INSERT")) === true && (await tpriv(c, "service_role", "jarvis_turns", "UPDATE")) === true && (await tpriv(c, "service_role", "jarvis_turns", "DELETE")) === false);
  check("54 no browser mutation policies", (await scalar(c, `select count(*)::int from pg_policies where tablename='jarvis_turns' and cmd<>'SELECT'`)) === 0);

  // ── linkage lifecycle: deletion of referenced row does NOT mutate turn; profile cascade DOES ──
  console.log("\n── linkage lifecycle (no FK; historical id preserved) ──");
  const thX = await scalar(c, `insert into public.jarvis_threads (workspace_id,user_id) values ('${WS}','${U.owner}') returning id`);
  const msgX = await scalar(c, `insert into public.jarvis_messages (thread_id,workspace_id,role,content) values ('${thX}','${WS}','user','hi') returning id`);
  const propX = await scalar(c, `insert into public.jarvis_proposals (workspace_id,capability_id,effect_hash,status,expires_at) values ('${WS}','portal.propose_internal_task','h','pending',now()+interval '1 day') returning id`);
  const memX = await scalar(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5) as id`, [WS, MEMROW("mem link"), U.owner, "O", "t"]);
  const tLink = await newTurn(c);
  await c.query(`update public.jarvis_turns set thread_id='${thX}', user_message_id='${msgX}', proposal_id='${propX}', memory_id='${memX}' where id='${tLink}'`);
  await c.query(`delete from public.jarvis_threads where id='${thX}'`); // cascades msgX
  await c.query(`delete from public.jarvis_proposals where id='${propX}'`);
  await c.query(`delete from public.jarvis_memories where id='${memX}'`);
  const row = (await c.query(`select thread_id,user_message_id,proposal_id,memory_id from public.jarvis_turns where id='${tLink}'`)).rows[0];
  check("55 deleting referenced thread/message/proposal/memory does NOT mutate the stored ids", row.thread_id === thX && row.user_message_id === msgX && row.proposal_id === propX && row.memory_id === memX);
  const tDel = await scalar(c, `insert into public.jarvis_turns (workspace_id,user_id,idempotency_key,request_hash,correlation_id,lease_expires_at) values ('${WS}','${U.del}',gen_random_uuid(),'${HEX}',gen_random_uuid(),now()+interval '1 min') returning id`);
  await c.query(`delete from public.profiles where id='${U.del}'`);
  check("56 profile deletion cascades the turn itself", (await scalar(c, `select count(*)::int from public.jarvis_turns where id='${tDel}'`)) === 0);

  // ── Memory idempotency primitives ──
  console.log("\n── Memory idempotency primitives ──");
  check("57 new columns exist", (await scalar(c, `select count(*)::int from information_schema.columns where table_name='jarvis_memories' and column_name in ('idempotency_key','idem_effect_hash')`)) === 2);
  check("58 partial unique index exists", (await scalar(c, `select count(*)::int from pg_indexes where tablename='jarvis_memories' and indexname='jarvis_memories_idem_key_uniq'`)) === 1);
  check("59 null-key legacy multi-create works", await (async () => { await memCreateLegacy(c, "legacy dup"); await memCreateLegacy(c, "legacy dup"); return (await scalar(c, `select count(*)::int from public.jarvis_memories where claim='legacy dup'`)) === 2; })());
  check("60 valid nonblank key + hex accepted", (await tryQ(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5,$6,$7)`, [WS, MEMROW("k ok"), U.owner, "O", "t", KEY("60"), HEX])).ok);
  check("61 empty-string key rejected", rejected(await tryQ(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5,$6,$7)`, [WS, MEMROW(), U.owner, "O", "t", "", HEX])));
  check("62 whitespace-only key rejected", rejected(await tryQ(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5,$6,$7)`, [WS, MEMROW(), U.owner, "O", "t", "   ", HEX])));
  check("63 >200-char key rejected", rejected(await tryQ(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5,$6,$7)`, [WS, MEMROW(), U.owner, "O", "t", "k".repeat(201), HEX])));
  check("64 non-hex effect hash rejected", rejected(await tryQ(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5,$6,$7)`, [WS, MEMROW(), U.owner, "O", "t", KEY("64"), NONHEX])));
  check("65 uppercase effect hash rejected", rejected(await tryQ(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5,$6,$7)`, [WS, MEMROW(), U.owner, "O", "t", KEY("65"), UPPER])));
  check("66 wrong-length effect hash rejected", rejected(await tryQ(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5,$6,$7)`, [WS, MEMROW(), U.owner, "O", "t", KEY("66"), SHORT])));

  // replay / conflict / event honesty
  const id1 = (await memCreate(c, KEY("70"), HEX, "idem one")).rows[0].id;
  const id2 = (await memCreate(c, KEY("70"), HEX, "idem one")).rows[0].id;
  check("67 same key+same hash → same id", id1 === id2);
  check("68 replay: no second row", (await scalar(c, `select count(*)::int from public.jarvis_memories where idempotency_key='${KEY("70")}'`)) === 1);
  check("69 replay: no second created event", (await scalar(c, `select count(*)::int from public.jarvis_memory_events where memory_id='${id1}' and event_type='created'`)) === 1);
  check("70 same key+different hash → BB68C", rejected(await tryQ(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5,$6,$7)`, [WS, MEMROW("changed"), U.owner, "O", "t", KEY("70"), "b".repeat(64)]), "BB68C"));
  check("71 conflict: no second row", (await scalar(c, `select count(*)::int from public.jarvis_memories where idempotency_key='${KEY("70")}'`)) === 1);
  check("72 conflict: no extra created event", (await scalar(c, `select count(*)::int from public.jarvis_memory_events where memory_id='${id1}' and event_type='created'`)) === 1);

  // ── concurrency (two independent connections) ──
  console.log("\n── Memory concurrency (two connections) ──");
  const c2 = new pg.Client({ connectionString: url }); await c2.connect();
  const [r1, r2] = await Promise.allSettled([memCreate(c, KEY("80"), HEX, "conc"), memCreate(c2, KEY("80"), HEX, "conc")]);
  check("73 concurrent same key+same hash → one row, same id", r1.status === "fulfilled" && r2.status === "fulfilled" && r1.value.rows[0].id === r2.value.rows[0].id && (await scalar(c, `select count(*)::int from public.jarvis_memories where idempotency_key='${KEY("80")}'`)) === 1);
  const [d1, d2] = await Promise.allSettled([memCreate(c, KEY("81"), HEX, "cdiff"), memCreate(c2, KEY("81"), "c".repeat(64), "cdiff")]);
  check("74 concurrent same key+diff hash → one winner + one BB68C, one row", [d1, d2].filter((r) => r.status === "fulfilled").length === 1 && [d1, d2].filter((r) => r.status === "rejected" && r.reason?.code === "BB68C").length === 1 && (await scalar(c, `select count(*)::int from public.jarvis_memories where idempotency_key='${KEY("81")}'`)) === 1);
  await c2.end();

  // ── Memory RPC security / inventory ──
  console.log("\n── Memory RPC inventory / ACLs ──");
  const sigs = (await c.query(`select pg_get_function_identity_arguments(oid) as args from pg_proc where proname='jarvis_memory_create' and pronamespace='public'::regnamespace`)).rows.map((r) => r.args);
  check("75 exactly one jarvis_memory_create signature", sigs.length === 1, JSON.stringify(sigs));
  check("76 no legacy 5-arg overload remains", sigs.every((s) => s.split(",").length === 7));
  const FN7 = "jarvis_memory_create(uuid,jsonb,uuid,text,text,text,text)";
  check("77 PUBLIC/anon/authenticated cannot execute", (await scalar(c, `select has_function_privilege('public','public.${FN7}','execute')`)) === false && (await fpriv(c, "anon", FN7)) === false && (await fpriv(c, "authenticated", FN7)) === false);
  check("78 service_role can execute", (await fpriv(c, "service_role", FN7)) === true);
  const meta = (await c.query(`select prosecdef, proconfig from pg_proc where proname='jarvis_memory_create' and pronamespace='public'::regnamespace`)).rows[0];
  check("79 SECURITY INVOKER + search_path=public", meta.prosecdef === false && (meta.proconfig || []).some((x) => x === "search_path=public"));

  // ── regression ──
  console.log("\n── regression ──");
  check("80 Memory event append-only UPDATE still rejected", rejected(await tryQ(c, `update public.jarvis_memory_events set reason='x' where true`)));
  check("81 jarvis_messages append-only trigger intact", (await scalar(c, `select count(*)::int from pg_trigger where tgname='jarvis_messages_no_mutation'`)) === 1);
  check("82 legacy 5-arg memory create still returns an id", typeof (await scalar(c, `select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5)`, [WS, MEMROW("legacy ok"), U.owner, "O", "t"])) === "string");
  check("83 default-privilege regression (anon INSERT probe true, turns false)", (await tpriv(c, "anon", "_defaults_probe", "INSERT")) === true && (await tpriv(c, "anon", "jarvis_turns", "INSERT")) === false);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0068 JARVIS TURN IDEMPOTENCY: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
const memCreateLegacy = (c, claim) => c.query(`select public.jarvis_memory_create($1,$2::jsonb,$3,$4,$5)`, [WS, MEMROW(claim), U.owner, "O", "t"]);
main().catch((e) => { console.error(e); process.exit(1); });
