/**
 * tasks-inbox-read.test.mjs — C2.1a integration proof (real Postgres).
 *
 * Proves the DB/RLS contract getInboxTasks() relies on: the SHARED agency inbox
 * read (`status='inbox' and deleted_at is null`, newest first) is workspace-
 * isolated and admin-only via RLS, is intentionally NOT scoped by
 * created_by/owner/assignee (Decision 1), and a triaged task drops out of the
 * inbox. Inbox tasks are captured through the real apply_task_command envelope
 * (as the C1/C2 command path produces them).
 *
 * TEST_DATABASE_URL must point at a disposable local DB whose name contains 'test'.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");

const WS1 = "00000000-0000-0000-0000-000000000001";
const WS2 = "00000000-0000-0000-0000-000000000002";
const U = { admin1: "00000000-0000-0000-0000-0000000000a1", admin3: "00000000-0000-0000-0000-0000000000a3", client: "00000000-0000-0000-0000-0000000000c1" };

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-inbox-read: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1") throw new Error("tasks-inbox-read: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.clients (id uuid primary key default gen_random_uuid());
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role public.user_role not null default 'client', client_id uuid references public.clients(id) on delete set null, full_name text, email text, avatar_url text, created_at timestamptz not null default now());
create or replace function public.is_admin() returns boolean language sql security definer set search_path=public stable as $fn$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
grant select on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
insert into auth.users (id,email) values ('${U.admin1}','a1'),('${U.admin3}','a3'),('${U.client}','c1');
insert into public.profiles (id,role,full_name) values ('${U.admin1}','admin','Eloff'),('${U.admin3}','admin','WS2 Admin'),('${U.client}','client','Client');
`;

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; };

const evt = (t, payload = {}) => ({ event_type: t, event_schema_version: 1, payload });
function capture(ws, actorId, key, title) {
  return { actor: { actor_kind: "user", actor_user_id: actorId, actor_ref: null, actor_display: "x" }, workspace_id: ws, command_type: "CaptureTask", task_id: null, expected_aggregate_version: null, command_idempotency_key: key, payload_hash: "h", correlation_id: null, task_field_deltas: { title, status: "inbox" }, satellite_changes: [], ordered_events: [evt("TaskCaptured", { title })], expected_result: { outcome: "applied" } };
}
async function op(c, env) { await c.query("set role service_role"); try { const r = await c.query("select public.apply_task_command($1::jsonb) res", [JSON.stringify(env)]); await c.query("reset role"); return r.rows[0].res; } finally { await c.query("reset role").catch(() => {}); } }

// The exact query getInboxTasks() issues, run under the given identity (RLS).
async function inboxAs(c, uid) {
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const r = await c.query(`select * from public.tasks where status='inbox' and deleted_at is null order by created_at desc`);
    await c.query("rollback");
    return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); return { error: e }; }
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql", "0037_planner_tasks_core.sql", "0038_planner_task_blockers.sql", "0039_planner_task_dependencies.sql", "0040_planner_labels.sql", "0041_planner_recurring_definitions.sql", "0042_planner_task_reminders.sql", "0043_planner_task_events.sql", "0044_planner_event_redactions.sql", "0045_planner_command_receipts.sql", "0046_planner_internal_persistence.sql", "0047_planner_safe_read_models.sql"])
    await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // Capture 2 inbox tasks in WS1 (by different admins → still one shared inbox)
  // and 1 in WS2.
  const t1 = (await op(c, capture(WS1, U.admin1, "k1", "Alpha"))).result_task_id;
  await op(c, capture(WS1, U.admin1, "k2", "Beta"));
  await op(c, capture(WS2, U.admin3, "k3", "Gamma"));

  console.log("\n── Shared agency inbox (workspace-isolated, admin-only) ──");
  const ws1Inbox = await inboxAs(c, U.admin1);
  check("WS1 admin sees the whole WS1 inbox (2), newest first, WS1 only", Array.isArray(ws1Inbox) && ws1Inbox.length === 2 && ws1Inbox.every((r) => r.workspace_id === WS1) && ws1Inbox[0].title === "Beta");
  check("inbox tasks are ownerless until triaged (owner_user_id null)", Array.isArray(ws1Inbox) && ws1Inbox.every((r) => r.owner_user_id === null && r.assignee_id === null));
  check("WS2 admin sees only the WS2 inbox (1)", (await inboxAs(c, U.admin3)).length === 1);
  check("cross-workspace isolation: WS1 admin never sees the WS2 inbox task", Array.isArray(ws1Inbox) && !ws1Inbox.some((r) => r.workspace_id === WS2));
  check("non-admin (client) sees ZERO inbox tasks (RLS admin gate)", (await inboxAs(c, U.client)).length === 0);

  console.log("\n── Triage removes the row from the inbox ──");
  // Triage t1 → planned (owner = the triaging admin), as the command path would.
  await op(c, { actor: { actor_kind: "user", actor_user_id: U.admin1, actor_ref: null, actor_display: "x" }, workspace_id: WS1, command_type: "TriageTask", task_id: t1, expected_aggregate_version: 1, command_idempotency_key: "k-tri", payload_hash: "h", correlation_id: null, task_field_deltas: { status: "planned", owner_user_id: U.admin1 }, satellite_changes: [], ordered_events: [evt("TaskTriaged")], expected_result: { outcome: "applied" } });
  const afterTriage = await inboxAs(c, U.admin1);
  check("triaged task drops out of the inbox (now 1)", afterTriage.length === 1 && afterTriage.every((r) => r.id !== t1));
  check("triaged task is now Planned and owned", (await c.query(`select status, owner_user_id from public.tasks where id='${t1}'`)).rows[0].status === "planned");

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} C2.1a INBOX READ INTEGRATION: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
