/**
 * tasks-command-adapter.test.mjs — Phase C1 integration proof (real Postgres).
 *
 * Runs the REAL 0036–0047 migrations, then exercises the DB contract the C1
 * command adapter depends on: the envelope the adapter builds → apply_task_command
 * (atomic state+version+events+receipt, replay, idempotency conflict, version
 * conflict, cross-workspace refusal), and the authenticated/RLS read surface the
 * read adapters use (read_task_events / read_task_reminders return only the safe
 * projection; raw engine tables stay unreadable to authenticated).
 *
 * The adapter's TypeScript half — TASKS_ENABLED gating, auth/admin/workspace
 * resolution, and the fact that actor/workspace are DERIVED (never caller-
 * supplied) — is proven by the Vitest suite (command-adapter.test.ts). This
 * harness builds the exact envelope the adapter emits and proves the database
 * half; together they cover the full path. Actor/workspace here are the derived
 * values the adapter would produce.
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-command-adapter: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1") throw new Error("tasks-command-adapter: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
const scalar = async (c, s, p = []) => { const { rows } = await c.query(s, p); return rows[0] ? Object.values(rows[0])[0] : undefined; };

// ── Envelope builders (exactly what the C1 adapter emits) ────────────────────
const ACTOR = { actor_kind: "user", actor_user_id: U.admin1, actor_ref: null, actor_display: "Eloff" };
const evt = (t, payload = {}) => ({ event_type: t, event_schema_version: 1, payload });
function envelope(o) {
  return {
    actor: o.actor ?? ACTOR, workspace_id: o.ws ?? WS1, command_type: o.command_type,
    task_id: o.task_id ?? null, expected_aggregate_version: o.ver ?? null,
    command_idempotency_key: o.key, payload_hash: o.hash ?? "ph", correlation_id: o.correlation_id ?? null,
    task_field_deltas: o.deltas ?? {}, satellite_changes: o.sat ?? [], ordered_events: o.events ?? [],
    expected_result: { outcome: "applied" },
  };
}
async function op(c, env) {
  await c.query("set role service_role");
  try { const r = await c.query("select public.apply_task_command($1::jsonb) res", [JSON.stringify(env)]); await c.query("reset role"); return { res: r.rows[0].res, error: null }; }
  catch (e) { await c.query("reset role").catch(() => {}); return { res: null, error: e }; }
}
async function asAdmin(c, uid, sql, params = []) {
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const r = await c.query(sql, params); await c.query("rollback");
    return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
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

  // ── Command envelope → apply_task_command: atomic create ───────────────────
  console.log("\n── Command apply (atomic) ──");
  const cap = await op(c, envelope({ command_type: "CaptureTask", key: "k-cap", hash: "h1", deltas: { title: "Alpha", status: "inbox" }, events: [evt("TaskCaptured", { title: "Alpha" })] }));
  const tid = cap.res?.result_task_id;
  check("CaptureTask envelope → applied v=1", cap.res?.outcome === "applied" && cap.res?.result_aggregate_version === 1);
  check("atomic: task + event + receipt all present", (await scalar(c, `select (select count(*) from tasks where id='${tid}')::int`)) === 1 && (await scalar(c, `select count(*)::int from task_events where task_id='${tid}'`)) === 1 && (await scalar(c, `select count(*)::int from command_receipts where idempotency_key='k-cap'`)) === 1);
  check("event records the derived actor from the envelope", (await scalar(c, `select actor_kind||'/'||actor_user_id||'/'||actor_display from task_events where task_id='${tid}'`)) === `user/${U.admin1}/Eloff`);

  // ── Replay (same key + same hash) ──────────────────────────────────────────
  console.log("\n── Replay / idempotency ──");
  const replay = await op(c, envelope({ command_type: "CaptureTask", key: "k-cap", hash: "h1", deltas: { title: "Alpha", status: "inbox" }, events: [evt("TaskCaptured", { title: "Alpha" })] }));
  check("replay (same key+hash) → replayed, no re-apply", replay.res?.outcome === "replayed" && (await scalar(c, `select count(*)::int from command_receipts where idempotency_key='k-cap'`)) === 1);
  const conflict = await op(c, envelope({ command_type: "CaptureTask", key: "k-cap", hash: "DIFFERENT", deltas: { title: "Alpha", status: "inbox" }, events: [evt("TaskCaptured")] }));
  check("same key + different hash → IdempotencyConflict (BB461)", conflict.error?.code === "BB461");

  // ── Version conflict ───────────────────────────────────────────────────────
  console.log("\n── Version conflict ──");
  await op(c, envelope({ command_type: "TriageTask", key: "k-tri", task_id: tid, ver: 1, deltas: { status: "planned", owner_user_id: U.admin1 }, events: [evt("TaskTriaged")] }));
  const stale = await op(c, envelope({ command_type: "ScheduleTask", key: "k-sch-stale", task_id: tid, ver: 1, deltas: { status: "scheduled", scheduled_date: "2026-08-10" }, events: [evt("TaskScheduled")] }));
  check("stale expected version → VersionConflict (BB460), no receipt", stale.error?.code === "BB460" && (await scalar(c, `select count(*)::int from command_receipts where idempotency_key='k-sch-stale'`)) === 0);

  // ── Cross-workspace refusal ────────────────────────────────────────────────
  console.log("\n── Cross-workspace ──");
  const wsTask = await op(c, envelope({ command_type: "CaptureTask", key: "k-ws2", ws: WS2, actor: { actor_kind: "user", actor_user_id: U.admin3, actor_ref: null, actor_display: "WS2" }, deltas: { title: "Beta", status: "inbox" }, events: [evt("TaskCaptured")] }));
  const cross = await op(c, envelope({ command_type: "CaptureTask", key: "k-cross", deltas: { title: "child", status: "inbox", parent_id: wsTask.res.result_task_id }, events: [evt("TaskCaptured")] }));
  check("cross-workspace parent reference refused (23503)", cross.error?.code === "23503");

  // ── RLS-protected reads + safe projections ─────────────────────────────────
  console.log("\n── RLS reads + safe projections ──");
  const ev = await asAdmin(c, U.admin1, `select * from public.read_task_events($1)`, [tid]);
  check("admin reads safe task events via RLS function", ev.error === null && ev.rowCount >= 1);
  check("safe events expose only the whitelisted columns (no raw payload)", ev.rows.length > 0 && !("payload" in ev.rows[0]) && "summary" in ev.rows[0] && "details" in ev.rows[0]);
  check("raw task_events unreadable to authenticated admin", (await asAdmin(c, U.admin1, `select * from public.task_events`)).rowCount === 0);
  check("cross-workspace admin gets ZERO safe events for a WS1 task", (await asAdmin(c, U.admin3, `select * from public.read_task_events($1)`, [tid])).rowCount === 0);
  check("non-admin denied safe events (BB472)", (await asAdmin(c, U.client, `select * from public.read_task_events($1)`, [tid])).error?.code === "BB472");
  await c.query("set role service_role");
  await c.query(`insert into public.task_reminders (workspace_id, task_id, remind_at, state) values ('${WS1}','${tid}', now() + interval '1 day', 'pending')`);
  await c.query("reset role");
  const rem = await asAdmin(c, U.admin1, `select * from public.read_task_reminders($1)`, [tid]);
  check("admin reads safe reminder intent; engine fields hidden", rem.rowCount === 1 && !("claim_token" in rem.rows[0]) && !("attempts" in rem.rows[0]) && "remind_at" in rem.rows[0]);
  check("raw task_reminders unreadable to authenticated admin", (await asAdmin(c, U.admin1, `select * from public.task_reminders`)).rowCount === 0);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} C1 COMMAND-ADAPTER INTEGRATION: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
