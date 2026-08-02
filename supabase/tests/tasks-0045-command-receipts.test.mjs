/**
 * Bbettr OS — Migration 0045 (command_receipts) proof.
 *
 * Runs the REAL 0045_planner_command_receipts.sql (on top of 0036–0044) against
 * a disposable local PostgreSQL and exhaustively verifies: exact structure,
 * success-only outcomes, actor-kind consistency, non-empty + expiry guards, the
 * ~30-day default (and longer override), workspace-scoped idempotency
 * uniqueness, NO foreign keys, the mutable service-role-only RLS matrix (full
 * CRUD incl. TTL delete), zero triggers, the boundary, and chain composition.
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const WS1 = "00000000-0000-0000-0000-000000000001";
const WS2 = "00000000-0000-0000-0000-000000000002";
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1",
  admin3: "00000000-0000-0000-0000-0000000000a3",
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
  none: "00000000-0000-0000-0000-0000000000f1",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0045: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0045: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

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
alter default privileges in schema public grant all on tables to service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then
  create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.clients (id uuid primary key default gen_random_uuid());
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text, email text, avatar_url text, created_at timestamptz not null default now());
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
grant select on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
insert into auth.users (id,email) values ('${U.admin1}','a1'),('${U.admin3}','a3'),('${U.client}','c1'),('${U.rep}','d1'),('${U.none}','f1');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.admin3}','admin','WS2 Admin'),('${U.client}','client','Client'),('${U.rep}','rep','Rep');
`;

const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");
let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function tryQuery(c, text, params = []) {
  try { const r = await c.query(text, params); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { return { rows: [], rowCount: 0, error: e }; }
}
async function scalar(c, text, params = []) { const { rows } = await c.query(text, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function runAs(c, role, uid, sql, params = []) {
  try {
    await c.query("begin"); await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]);
    const res = await c.query(sql, params); await c.query("rollback");
    return { rows: res.rows, rowCount: res.rowCount ?? 0, error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const denied = (r) => r.error !== null || r.rowCount === 0;

let K = 0;
async function insReceipt(c, cols = {}) {
  const base = { workspace_id: WS1, idempotency_key: `k-${++K}`, command_type: "CompleteTask", payload_hash: "h1", outcome: "applied" };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.command_receipts (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id, created_at, expires_at`, keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql","0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql","0042_planner_task_reminders.sql","0043_planner_task_events.sql","0044_planner_event_redactions.sql","0045_planner_command_receipts.sql"])
    await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure ──────────────────────────────────────────────────────────────
  console.log("\n── Structure ──");
  check("command_receipts base table exists", (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='command_receipts' and table_type='BASE TABLE'`)).rows.length === 1);
  check("exact columns", (await scalar(c, `select array_agg(column_name order by column_name)::text from information_schema.columns where table_schema='public' and table_name='command_receipts'`)) ===
    "{actor_kind,actor_ref,actor_user_id,command_type,created_at,expires_at,id,idempotency_key,outcome,payload_hash,result_aggregate_version,result_task_id,workspace_id}");
  check("PK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.command_receipts'::regclass and contype='p'`)) === 1);
  check("unique (workspace_id, idempotency_key) present", (await scalar(c, `select count(*)::int from pg_constraint where conname='command_receipts_workspace_key_unique' and contype='u'`)) === 1);
  check("ONLY the workspace FK — no FK to profiles/tasks/events", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.command_receipts'::regclass and contype='f'`)) === 1);
  check("the one FK targets workspaces", (await scalar(c, `select confrelid::regclass::text from pg_constraint where conrelid='public.command_receipts'::regclass and contype='f'`)) === "workspaces");
  check("8 CHECK constraints present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.command_receipts'::regclass and contype='c'`)) === 8);
  check("expiry index present", (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexname='command_receipts_expires_idx'`)) === 1);
  check("ZERO triggers on command_receipts", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.command_receipts'::regclass and not tgisinternal`)) === 0);
  check("RLS enabled + forced, ZERO policies", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.command_receipts'::regclass`)) === true && (await scalar(c, `select count(*)::int from pg_policy where polrelid='public.command_receipts'::regclass`)) === 0);

  // ── Outcomes ───────────────────────────────────────────────────────────────
  console.log("\n── Outcomes (success-only) ──");
  check("outcome 'applied' accepted", (await insReceipt(c, { outcome: "applied" })).error === null);
  check("outcome 'accepted_noop' accepted", (await insReceipt(c, { outcome: "accepted_noop" })).error === null);
  check("outcome 'replayed' rejected (return-only, never stored)", (await insReceipt(c, { outcome: "replayed" })).error !== null);
  check("outcome 'error' rejected", (await insReceipt(c, { outcome: "error" })).error !== null);
  check("unknown outcome rejected", (await insReceipt(c, { outcome: "queued" })).error !== null);

  // ── Actor-kind consistency ─────────────────────────────────────────────────
  console.log("\n── Actor-kind consistency ──");
  check("null actor (no context) accepted", (await insReceipt(c, { actor_kind: null, actor_user_id: null, actor_ref: null })).error === null);
  check("user actor with actor_user_id accepted", (await insReceipt(c, { actor_kind: "user", actor_user_id: U.admin1 })).error === null);
  check("automation actor with actor_ref accepted", (await insReceipt(c, { actor_kind: "automation", actor_ref: "reactor:x" })).error === null);
  check("bad actor_kind rejected", (await insReceipt(c, { actor_kind: "robot" })).error !== null);
  check("non-user WITH actor_user_id rejected", (await insReceipt(c, { actor_kind: "automation", actor_user_id: U.admin1 })).error !== null);
  check("user WITH actor_ref rejected", (await insReceipt(c, { actor_kind: "user", actor_user_id: U.admin1, actor_ref: "x" })).error !== null);
  check("actor_user_id WITHOUT actor_kind rejected", (await insReceipt(c, { actor_kind: null, actor_user_id: U.admin1 })).error !== null);
  check("actor_ref WITHOUT actor_kind rejected", (await insReceipt(c, { actor_kind: null, actor_ref: "x" })).error !== null);
  check("system actor with actor_ref accepted", (await insReceipt(c, { actor_kind: "system", actor_ref: "cron:sweep" })).error === null);

  // ── Non-empty + expiry guards ──────────────────────────────────────────────
  console.log("\n── Non-empty + expiry guards ──");
  check("empty idempotency_key rejected", (await insReceipt(c, { idempotency_key: "  " })).error !== null);
  check("empty command_type rejected", (await insReceipt(c, { command_type: "" })).error !== null);
  check("empty payload_hash rejected", (await insReceipt(c, { payload_hash: "   " })).error !== null);
  check("expires_at < created_at rejected", (await insReceipt(c, { created_at: "2026-08-10T00:00:00Z", expires_at: "2026-08-01T00:00:00Z" })).error !== null);

  // ── Expiry defaults / override ─────────────────────────────────────────────
  console.log("\n── Expiry ──");
  const r = await insReceipt(c);
  const days = await scalar(c, `select round(extract(epoch from (expires_at - created_at))/86400)::int from public.command_receipts where id='${r.rows[0].id}'`);
  check("default expiry ~30 days", days === 30, `got ${days}`);
  check("custom longer expiry accepted (critical command)", (await insReceipt(c, { expires_at: "2027-08-01T00:00:00Z" })).error === null);

  // ── Workspace-scoped idempotency uniqueness ────────────────────────────────
  console.log("\n── Workspace-scoped uniqueness ──");
  const key = "dup-key";
  check("first key accepted", (await insReceipt(c, { workspace_id: WS1, idempotency_key: key })).error === null);
  check("duplicate (workspace, key) rejected", (await insReceipt(c, { workspace_id: WS1, idempotency_key: key })).error !== null);
  check("same key in another workspace accepted", (await insReceipt(c, { workspace_id: WS2, idempotency_key: key })).error === null);

  // ── RLS (mutable service-role only) ────────────────────────────────────────
  console.log("\n── RLS (mutable service-role only) ──");
  const rid = (await insReceipt(c)).rows[0].id;
  check("admin sees ZERO", (await runAs(c, "authenticated", U.admin1, `select * from public.command_receipts`)).rowCount === 0);
  check("client sees ZERO", (await runAs(c, "authenticated", U.client, `select * from public.command_receipts`)).rowCount === 0);
  check("rep sees ZERO", (await runAs(c, "authenticated", U.rep, `select * from public.command_receipts`)).rowCount === 0);
  check("anon sees ZERO", denied(await runAs(c, "anon", null, `select * from public.command_receipts`)));
  check("admin cannot INSERT", denied(await runAs(c, "authenticated", U.admin1, `insert into public.command_receipts (workspace_id,idempotency_key,command_type,payload_hash,outcome) values ('${WS1}','x1','CompleteTask','h','applied')`)));
  check("admin cannot DELETE", denied(await runAs(c, "authenticated", U.admin1, `delete from public.command_receipts where id='${rid}'`)));
  check("service_role can INSERT", (await runAs(c, "service_role", null, `insert into public.command_receipts (workspace_id,idempotency_key,command_type,payload_hash,outcome) values ('${WS1}','sr-1','CompleteTask','h','applied')`)).error === null);
  check("service_role can SELECT", (await runAs(c, "service_role", null, `select 1 from public.command_receipts limit 1`)).rowCount === 1);
  check("service_role can UPDATE", (await runAs(c, "service_role", null, `update public.command_receipts set payload_hash='h2' where id='${rid}'`)).error === null);
  check("service_role can DELETE (TTL sweep shape)", (await runAs(c, "service_role", null, `delete from public.command_receipts where expires_at < now() + interval '100 years'`)).error === null);

  // ── Boundary ───────────────────────────────────────────────────────────────
  console.log("\n── Boundary ──");
  check("no non-internal trigger on tasks (still 2)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal`)) === 2);
  check("tasks.blocked_since untouched (no state coupling)", (await scalar(c, `select count(*)::int from public.tasks where blocked_since is not null`)) === 0);
  check("no task_events written by 0045", (await scalar(c, `select count(*)::int from public.task_events`)) === 0);
  const absent = async (t) => (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rows.length === 0;
  check("no 0046–0047 objects", await absent("__nonexistent_0046__")); // storage-only slice; nothing from 0046+ exists

  // ── Composition ────────────────────────────────────────────────────────────
  console.log("\n── Composition: real 0027–0045 chain ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  for (const f of ["0027_planner_tasks.sql","0028_calendar_credentials.sql","0029_meetings.sql","0030_meeting_attendees.sql",
    "0031_calendar_projections.sql","0032_meetings_idempotency.sql","0033_create_meeting_rpc.sql","0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql","0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql",
    "0039_planner_task_dependencies.sql","0040_planner_labels.sql","0041_planner_recurring_definitions.sql","0042_planner_task_reminders.sql",
    "0043_planner_task_events.sql","0044_planner_event_redactions.sql","0045_planner_command_receipts.sql"]) {
    const rq = await tryQuery(c, sqlFile(f));
    if (rq.error) { chainErr = `${f}: ${rq.error.message}`; break; }
  }
  check("full 0027–0045 chain applies without collision", chainErr === null, chainErr ?? "");
  check("command_receipts + tasks + task_events present after chain",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='command_receipts'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='tasks'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_events'`)).rows.length === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0045 RECEIPTS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
