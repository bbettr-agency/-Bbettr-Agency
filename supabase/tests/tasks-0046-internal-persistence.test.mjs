/**
 * tasks-0046-internal-persistence.test.mjs
 *
 * Real-Postgres proof for the atomic persistence boundary (0046). Runs the REAL
 * 0036–0046 migrations against a disposable Postgres and exercises
 * public.apply_task_command(jsonb) / public.apply_event_redaction(jsonb) through
 * the service_role, asserting the locked invariants:
 *   internal-only access · atomic state+events+receipt · op-owned aggregate
 *   version + event identity · optimistic concurrency · success-only immutable
 *   receipts (replay never touches them) · structural command/event contract ·
 *   blocker/Waiting aggregation · dependency coupling · label no-ops · recurrence
 *   permanent idempotency · append-only history · redaction overlay ·
 *   concurrent replay / completion / duplicate-key.
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
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1",
  admin3: "00000000-0000-0000-0000-0000000000a3",
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0046: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0046: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
insert into auth.users (id,email) values ('${U.admin1}','a1'),('${U.admin3}','a3'),('${U.client}','c1'),('${U.rep}','d1');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.admin3}','admin','WS2 Admin'),('${U.client}','client','Client'),('${U.rep}','rep','Rep');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, text, params = []) { const { rows } = await c.query(text, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }

// ── Op invocation helpers ────────────────────────────────────────────────────
const ACTOR = { actor_kind: "user", actor_user_id: U.admin1, actor_display: "Eloff" };
let K = 0;
const evt = (type, payload = {}) => ({ event_type: type, event_schema_version: 1, payload });
function env(cmd, o = {}) {
  return {
    workspace_id: o.ws ?? WS1, command_type: cmd, actor: o.actor ?? ACTOR,
    command_idempotency_key: o.key ?? `k-${++K}`, payload_hash: o.hash ?? "ph",
    task_id: o.task_id ?? null,
    expected_aggregate_version: o.ver ?? null,
    task_field_deltas: o.deltas ?? {}, satellite_changes: o.sat ?? [],
    ordered_events: o.events ?? [], expected_result: { outcome: o.outcome ?? "applied" },
    ...(o.correlation_id ? { correlation_id: o.correlation_id } : {}),
  };
}
// Autocommit call as service_role (writes persist).
async function op(c, e) {
  await c.query("set role service_role");
  try { const r = await c.query("select public.apply_task_command($1::jsonb) res", [JSON.stringify(e)]); await c.query("reset role"); return { res: r.rows[0].res, error: null }; }
  catch (err) { await c.query("reset role").catch(() => {}); return { res: null, error: err }; }
}
async function opAs(c, role, uid, e) {
  try {
    await c.query("begin"); await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]);
    await c.query("select public.apply_task_command($1::jsonb)", [JSON.stringify(e)]);
    await c.query("rollback"); return { error: null };
  } catch (err) { await c.query("rollback").catch(() => {}); return { error: err }; }
}
const errCode = (r) => r.error && (r.error.code || "");

// ── State builders (drive real command chains) ───────────────────────────────
async function capture(c, o = {}) {
  const r = await op(c, env("CaptureTask", { deltas: { title: o.title ?? "T", status: "inbox" }, events: [evt("TaskCaptured")], ...o }));
  return r.res.result_task_id;
}
async function makePlanned(c) {
  const id = await capture(c);
  await op(c, env("TriageTask", { task_id: id, ver: 1, deltas: { status: "planned", owner_user_id: U.admin1 }, events: [evt("TaskTriaged")] }));
  return { id, version: 2 };
}
async function makeScheduled(c) {
  const t = await makePlanned(c);
  await op(c, env("ScheduleTask", { task_id: t.id, ver: 2, deltas: { status: "scheduled", scheduled_date: "2026-08-10" }, events: [evt("TaskScheduled")] }));
  return { id: t.id, version: 3 };
}
async function makeInProgress(c) {
  const t = await makeScheduled(c);
  await op(c, env("StartTask", { task_id: t.id, ver: 3, deltas: { status: "in_progress", assignee_id: U.admin1 }, events: [evt("TaskStarted")] }));
  return { id: t.id, version: 4 };
}
async function makeWaiting(c) {
  const t = await makeScheduled(c);
  await op(c, env("BlockTask", {
    task_id: t.id, ver: 3, deltas: { status: "waiting", resume_target: "scheduled" },
    sat: [{ op: "blocker_add", blocker_class: "person", blocker_key: `person:${U.admin1}`, reference_user_id: U.admin1 }],
    events: [evt("TaskBlocked")],
  }));
  return { id: t.id, version: 4 };
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql", "0037_planner_tasks_core.sql", "0038_planner_task_blockers.sql", "0039_planner_task_dependencies.sql", "0040_planner_labels.sql", "0041_planner_recurring_definitions.sql", "0042_planner_task_reminders.sql", "0043_planner_task_events.sql", "0044_planner_event_redactions.sql", "0045_planner_command_receipts.sql", "0046_planner_internal_persistence.sql"])
    await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  const c2 = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect(); await c2.connect();
  await setup(c);

  // ── Structure & security posture ───────────────────────────────────────────
  console.log("\n── Structure & security ──");
  check("apply_task_command exists", (await scalar(c, `select count(*)::int from pg_proc where proname='apply_task_command'`)) === 1);
  check("apply_event_redaction exists", (await scalar(c, `select count(*)::int from pg_proc where proname='apply_event_redaction'`)) === 1);
  check("apply_task_command is SECURITY INVOKER (not definer)", (await scalar(c, `select prosecdef from pg_proc where proname='apply_task_command'`)) === false);
  check("apply_task_command sets search_path=public", String(await scalar(c, `select array_to_string(proconfig,',') from pg_proc where proname='apply_task_command'`)).includes("search_path=public"));
  check("EXECUTE revoked from anon", (await scalar(c, `select has_function_privilege('anon','public.apply_task_command(jsonb)','execute')`)) === false);
  check("EXECUTE revoked from authenticated", (await scalar(c, `select has_function_privilege('authenticated','public.apply_task_command(jsonb)','execute')`)) === false);
  check("EXECUTE granted to service_role", (await scalar(c, `select has_function_privilege('service_role','public.apply_task_command(jsonb)','execute')`)) === true);
  check("redaction EXECUTE revoked from authenticated", (await scalar(c, `select has_function_privilege('authenticated','public.apply_event_redaction(jsonb)','execute')`)) === false);
  check("redaction EXECUTE granted to service_role", (await scalar(c, `select has_function_privilege('service_role','public.apply_event_redaction(jsonb)','execute')`)) === true);

  // ── Internal-only access ───────────────────────────────────────────────────
  console.log("\n── Internal-only access ──");
  check("authenticated CANNOT execute op", errCode(await opAs(c, "authenticated", U.admin1, env("CaptureTask", { deltas: { title: "x", status: "inbox" }, events: [evt("TaskCaptured")] }))) === "42501");
  check("anon CANNOT execute op", errCode(await opAs(c, "anon", null, env("CaptureTask", { deltas: { title: "x", status: "inbox" }, events: [evt("TaskCaptured")] }))) === "42501");
  check("authenticated CANNOT direct-write tasks", await (async () => { const r = await opAs(c, "authenticated", U.admin1, env("CaptureTask")); return true; })() && (await (async () => {
    try { await c.query("begin"); await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U.admin1, role: "authenticated" })]);
      await c.query(`insert into public.tasks (workspace_id,title,created_by,status) values ('${WS1}','x','${U.admin1}','inbox')`); await c.query("rollback"); return false; }
    catch { await c.query("rollback").catch(() => {}); return true; }
  })()));
  check("service_role CAN execute op", (await op(c, env("CaptureTask", { deltas: { title: "svc", status: "inbox" }, events: [evt("TaskCaptured")] }))).error === null);

  // ── Create atomicity: state + event + receipt ──────────────────────────────
  console.log("\n── Create atomicity ──");
  const capKey = "cap-1";
  const cap = await op(c, env("CaptureTask", { key: capKey, deltas: { title: "Alpha", status: "inbox" }, events: [evt("TaskCaptured", { title: "Alpha" })] }));
  const tid = cap.res.result_task_id;
  check("CaptureTask returns applied v=1", cap.res.outcome === "applied" && cap.res.result_aggregate_version === 1);
  check("task row created at v=1, status inbox", (await scalar(c, `select aggregate_version||':'||status from public.tasks where id='${tid}'`)) === "1:inbox");
  check("created_by = acting user; created_at/updated_at stamped", (await scalar(c, `select created_by='${U.admin1}' and created_at is not null and updated_at is not null from public.tasks where id='${tid}'`)) === true);
  check("exactly one TaskCaptured event at v=1 seq=1", (await scalar(c, `select aggregate_version||':'||event_sequence||':'||event_type from public.task_events where task_id='${tid}'`)) === "1:1:TaskCaptured");
  check("op stamped event identity (event_id + occurred_at)", (await scalar(c, `select event_id is not null and occurred_at is not null from public.task_events where task_id='${tid}'`)) === true);
  check("op recorded the passed actor into the event", (await scalar(c, `select actor_kind||'/'||actor_user_id||'/'||actor_display from public.task_events where task_id='${tid}'`)) === `user/${U.admin1}/Eloff`);
  check("exactly one success receipt (applied) for the key", (await scalar(c, `select outcome from public.command_receipts where workspace_id='${WS1}' and idempotency_key='${capKey}'`)) === "applied");
  check("receipt links result task + version", (await scalar(c, `select result_task_id='${tid}' and result_aggregate_version=1 from public.command_receipts where idempotency_key='${capKey}'`)) === true);

  // ── Version + event-identity ownership (caller cannot supply) ───────────────
  console.log("\n── Ownership (version + event identity) ──");
  const own = await op(c, env("CaptureTask", { deltas: { title: "Own", status: "inbox", aggregate_version: 999, created_by: U.rep, created_at: "2000-01-01", started_at: "2000-01-01", completed_at: "2000-01-01", deleted_at: "2000-01-01" }, events: [evt("TaskCaptured")] }));
  const oid = own.res.result_task_id;
  check("caller-supplied aggregate_version ignored (op computes 1)", own.res.result_aggregate_version === 1 && (await scalar(c, `select aggregate_version from public.tasks where id='${oid}'`)) === 1);
  check("caller-supplied created_by ignored (op uses actor)", (await scalar(c, `select created_by='${U.admin1}' from public.tasks where id='${oid}'`)) === true);
  check("caller-supplied protected timestamps ignored", (await scalar(c, `select started_at is null and completed_at is null and deleted_at is null and created_at > '2020-01-01' from public.tasks where id='${oid}'`)) === true);

  // ── Optimistic concurrency: stale version ──────────────────────────────────
  console.log("\n── Optimistic concurrency ──");
  const sc = await makeScheduled(c);
  const beforeEvents = await scalar(c, `select count(*)::int from public.task_events where task_id='${sc.id}'`);
  const vc = await op(c, env("StartTask", { key: "stale-1", task_id: sc.id, ver: 1, deltas: { status: "in_progress", assignee_id: U.admin1 }, events: [evt("TaskStarted")] }));
  check("stale expected_version → VersionConflict (BB460)", errCode(vc) === "BB460");
  check("VersionConflict left NO receipt (key retryable)", (await scalar(c, `select count(*)::int from public.command_receipts where idempotency_key='stale-1'`)) === 0);
  check("VersionConflict left NO event / NO version change", (await scalar(c, `select count(*)::int from public.task_events where task_id='${sc.id}'`)) === beforeEvents && (await scalar(c, `select aggregate_version from public.tasks where id='${sc.id}'`)) === 3);
  const good = await op(c, env("StartTask", { task_id: sc.id, ver: 3, deltas: { status: "in_progress", assignee_id: U.admin1 }, events: [evt("TaskStarted")] }));
  check("correct expected_version → applied, version bumped once to 4", good.res.result_aggregate_version === 4);

  // ── Structural command/event contract ──────────────────────────────────────
  console.log("\n── EventContractViolation matrix ──");
  const p = await makePlanned(c);
  check("unknown command_type rejected", errCode(await op(c, env("FrobnicateTask", { task_id: p.id, ver: 2, events: [evt("TaskTriaged")] }))) === "BB462");
  check("zero-event mutation rejected", errCode(await op(c, env("RenameTask", { task_id: p.id, ver: 2, deltas: { title: "New" }, events: [] }))) === "BB462");
  check("missing required event rejected (TriageAndSchedule needs 2)", errCode(await op(c, env("TriageAndScheduleTask", { task_id: p.id, ver: 2, deltas: { status: "scheduled" }, events: [evt("TaskTriaged")] }))) === "BB462");
  check("extra unrelated event rejected", errCode(await op(c, env("RenameTask", { task_id: p.id, ver: 2, deltas: { title: "New" }, events: [evt("TaskRenamed"), evt("TaskScheduled")] }))) === "BB462");
  check("wrong event order rejected (Complete-from-waiting)", errCode(await op(c, env("CompleteTask", { task_id: p.id, ver: 2, deltas: { status: "completed" }, events: [evt("TaskCompleted"), evt("TaskUnblocked")] }))) === "BB462");
  check("attribute-only command carrying a status change rejected", errCode(await op(c, env("RenameTask", { task_id: p.id, ver: 2, deltas: { title: "New", status: "scheduled" }, events: [evt("TaskRenamed")] }))) === "BB462");
  check("TaskCompleted without resulting completed rejected", errCode(await op(c, env("CompleteTask", { task_id: p.id, ver: 2, deltas: { status: "planned" }, events: [evt("TaskCompleted")] }))) === "BB462");
  check("malformed event_schema_version rejected", errCode(await op(c, env("RenameTask", { task_id: p.id, ver: 2, deltas: { title: "New" }, events: [{ event_type: "TaskRenamed", event_schema_version: 0, payload: {} }] }))) === "BB462");
  check("contract failures wrote NOTHING (planned task still v=2, 2 events)", (await scalar(c, `select aggregate_version from public.tasks where id='${p.id}'`)) === 2 && (await scalar(c, `select count(*)::int from public.task_events where task_id='${p.id}'`)) === 2);

  // ── Idempotency: replay never touches the stored receipt ───────────────────
  console.log("\n── Idempotency / immutable receipts ──");
  const rk = "replay-1";
  const a1 = await op(c, env("RenameTask", { key: rk, hash: "H1", task_id: p.id, ver: 2, deltas: { title: "Renamed" }, events: [evt("TaskRenamed")] }));
  check("first apply bumps to v=3", a1.res.result_aggregate_version === 3);
  const before = await c.query(`select outcome, result_aggregate_version, created_at, expires_at, md5(t.*::text) h from public.command_receipts t where idempotency_key='${rk}'`);
  const replay = await op(c, env("RenameTask", { key: rk, hash: "H1", task_id: p.id, ver: 2, deltas: { title: "Renamed" }, events: [evt("TaskRenamed")] }));
  check("replay returns 'replayed' with stored outcome", replay.res.outcome === "replayed" && replay.res.stored_outcome === "applied");
  check("replay did NOT re-apply (task still v=3)", (await scalar(c, `select aggregate_version from public.tasks where id='${p.id}'`)) === 3);
  const after = await c.query(`select md5(t.*::text) h, count(*) over() n from public.command_receipts t where idempotency_key='${rk}'`);
  check("replay left receipt byte-identical (no UPDATE/TTL touch)", before.rows[0].h === after.rows[0].h);
  check("replay created NO new receipt row", Number(after.rows[0].n) === 1);
  check("same key + DIFFERENT payload → IdempotencyConflict (BB461)", errCode(await op(c, env("RenameTask", { key: rk, hash: "H2", task_id: p.id, ver: 2, deltas: { title: "Other" }, events: [evt("TaskRenamed")] }))) === "BB461");

  // ── Protected-field derivation ─────────────────────────────────────────────
  console.log("\n── Protected-field derivation ──");
  const ip = await makeInProgress(c);
  check("StartTask stamped started_at", (await scalar(c, `select started_at is not null from public.tasks where id='${ip.id}'`)) === true);
  await op(c, env("CompleteTask", { task_id: ip.id, ver: 4, deltas: { status: "completed" }, events: [evt("TaskCompleted")] }));
  check("CompleteTask stamped completed_at + completed_by", (await scalar(c, `select completed_at is not null and completed_by='${U.admin1}' from public.tasks where id='${ip.id}'`)) === true);
  await op(c, env("ArchiveTask", { task_id: ip.id, ver: 5, deltas: { status: "archived" }, events: [evt("TaskArchived")] }));
  check("ArchiveTask(retention) PRESERVES completion metadata", (await scalar(c, `select archive_reason='retention' and completed_at is not null and completed_by is not null from public.tasks where id='${ip.id}'`)) === true);
  // Drop path on a fresh actionable task.
  const dr = await makeScheduled(c);
  await op(c, env("DropTask", { task_id: dr.id, ver: 3, deltas: { status: "archived" }, events: [evt("TaskDropped")] }));
  check("DropTask(cancelled) forces completion metadata NULL", (await scalar(c, `select archive_reason='cancelled' and completed_at is null and completed_by is null from public.tasks where id='${dr.id}'`)) === true);
  await op(c, env("RestoreTask", { task_id: dr.id, ver: 4, deltas: { status: "planned" }, events: [evt("TaskRestored")] }));
  check("RestoreTask clears archive/completion/started/scheduled", (await scalar(c, `select status='planned' and archived_at is null and archive_reason is null and completed_at is null and started_at is null and scheduled_date is null from public.tasks where id='${dr.id}'`)) === true);
  check("Restore left historical events intact (Drop event still present)", (await scalar(c, `select count(*)::int from public.task_events where task_id='${dr.id}' and event_type='TaskDropped'`)) === 1);

  // ── Atomic rollback (failure rolls back state + events + receipt) ───────────
  console.log("\n── Atomic rollback ──");
  const rb = await makeScheduled(c);
  const rbEvents = await scalar(c, `select count(*)::int from public.task_events where task_id='${rb.id}'`);
  const startNoAssignee = await op(c, env("StartTask", { key: "rb-1", task_id: rb.id, ver: 3, deltas: { status: "in_progress" }, events: [evt("TaskStarted")] }));
  check("StartTask without assignee fails on DB CHECK", startNoAssignee.error !== null);
  check("rollback: task unchanged (still v=3, scheduled)", (await scalar(c, `select aggregate_version||':'||status from public.tasks where id='${rb.id}'`)) === "3:scheduled");
  check("rollback: no event appended, no receipt written", (await scalar(c, `select count(*)::int from public.task_events where task_id='${rb.id}'`)) === rbEvents && (await scalar(c, `select count(*)::int from public.command_receipts where idempotency_key='rb-1'`)) === 0);

  // ── Blocker aggregation & Waiting ──────────────────────────────────────────
  console.log("\n── Blocker aggregation / Waiting ──");
  const wt = await makeWaiting(c);
  check("BlockTask → waiting, blocked_since set, resume_target recorded", (await scalar(c, `select status='waiting' and blocked_since is not null and resume_target='scheduled' from public.tasks where id='${wt.id}'`)) === true);
  // Second, older blocker → blocked_since must be the MIN active created_at.
  await c.query(`update public.task_blockers set created_at = now() - interval '2 days' where task_id='${wt.id}'`);
  await op(c, env("BlockTask", { task_id: wt.id, ver: 4, deltas: { status: "waiting", resume_target: "scheduled" }, sat: [{ op: "blocker_add", blocker_class: "approval", blocker_key: "approval:copy" }], events: [evt("TaskBlocked")] }));
  check("blocked_since = MIN(active blocker created_at)", (await scalar(c, `select blocked_since = (select min(created_at) from public.task_blockers where task_id='${wt.id}' and resolved_at is null) from public.tasks where id='${wt.id}'`)) === true);
  // Atomic completion from Waiting → two ordered events, one version.
  const cw = await op(c, env("CompleteTask", {
    task_id: wt.id, ver: 5, deltas: { status: "completed" },
    sat: [{ op: "blocker_resolve", blocker_key: `person:${U.admin1}` }, { op: "blocker_resolve", blocker_key: "approval:copy" }],
    events: [evt("TaskUnblocked"), evt("TaskCompleted")],
  }));
  check("Waiting-completion commits at one new version (6)", cw.res.result_aggregate_version === 6);
  check("two ordered events at v=6: TaskUnblocked seq1, TaskCompleted seq2", (await scalar(c, `select string_agg(event_type, ',' order by event_sequence) from public.task_events where task_id='${wt.id}' and aggregate_version=6`)) === "TaskUnblocked,TaskCompleted");
  check("Waiting-completion cleared blocked_since/resume_target, resolved blockers", (await scalar(c, `select status='completed' and blocked_since is null and resume_target is null from public.tasks where id='${wt.id}'`)) === true && (await scalar(c, `select count(*)::int from public.task_blockers where task_id='${wt.id}' and resolved_at is null`)) === 0);

  // ── Dependency coupling ────────────────────────────────────────────────────
  console.log("\n── Dependency coupling ──");
  const dep = await makeScheduled(c);      // dependent
  const pre = await makeScheduled(c);      // prerequisite
  const addDep = await op(c, env("AddDependency", {
    task_id: dep.id, ver: 3, deltas: { status: "waiting", resume_target: "scheduled" },
    sat: [
      { op: "dependency_add", prerequisite_id: pre.id, kind: "hard" },
      { op: "blocker_add", blocker_class: "dependency", blocker_key: `dependency:${pre.id}`, reference_task_id: pre.id },
    ],
    events: [evt("DependencyAdded"), evt("TaskBlocked")],
  }));
  check("AddDependency(auto-block): DependencyAdded then TaskBlocked, status waiting", addDep.res.result_aggregate_version === 4 && (await scalar(c, `select string_agg(event_type, ',' order by event_sequence) from public.task_events where task_id='${dep.id}' and aggregate_version=4`)) === "DependencyAdded,TaskBlocked" && (await scalar(c, `select status from public.tasks where id='${dep.id}'`)) === "waiting");
  check("active hard dependency edge + dependency blocker exist", (await scalar(c, `select count(*)::int from public.task_dependencies where dependent_id='${dep.id}' and resolved_at is null`)) === 1 && (await scalar(c, `select count(*)::int from public.task_blockers where task_id='${dep.id}' and blocker_class='dependency' and resolved_at is null`)) === 1);
  // Cycle guard backstop: pre depends on dep (hard) would close a cycle.
  const cyc = await op(c, env("AddDependency", { task_id: pre.id, ver: 3, deltas: {}, sat: [{ op: "dependency_add", prerequisite_id: dep.id, kind: "hard" }], events: [evt("DependencyAdded")] }));
  check("cycle-closing hard edge rejected by DB backstop (BB390)", errCode(cyc) === "BB390");

  // ── Labels ─────────────────────────────────────────────────────────────────
  console.log("\n── Labels ──");
  const activeLabel = await scalar(c, `insert into public.labels (workspace_id,name,color_token) values ('${WS1}','urgent','red') returning id`);
  const archLabel = await scalar(c, `insert into public.labels (workspace_id,name,color_token,archived_at) values ('${WS1}','old','gray', now()) returning id`);
  const lt = await makePlanned(c);
  await op(c, env("AddLabel", { task_id: lt.id, ver: 2, sat: [{ op: "label_add", label_id: activeLabel }], events: [evt("TaskLabeled")] }));
  check("AddLabel associates the label", (await scalar(c, `select count(*)::int from public.task_labels where task_id='${lt.id}' and label_id='${activeLabel}'`)) === 1);
  const dupLabel = await op(c, env("AddLabel", { task_id: lt.id, ver: 3, sat: [{ op: "label_add", label_id: activeLabel }], events: [evt("TaskLabeled")] }));
  check("duplicate AddLabel is an accepted no-op (still one association)", dupLabel.error === null && (await scalar(c, `select count(*)::int from public.task_labels where task_id='${lt.id}' and label_id='${activeLabel}'`)) === 1);
  check("AddLabel with an ARCHIVED label is rejected (BB465)", errCode(await op(c, env("AddLabel", { task_id: lt.id, ver: 4, sat: [{ op: "label_add", label_id: archLabel }], events: [evt("TaskLabeled")] }))) === "BB465");

  // ── Recurrence permanent idempotency ───────────────────────────────────────
  console.log("\n── Recurrence permanent idempotency ──");
  const defId = await scalar(c, `insert into public.recurring_definitions (workspace_id,owner_user_id,template_title,template_priority,rule_interval,rule_unit,mode,missed_policy) values ('${WS1}','${U.admin1}','Weekly','normal',1,'week','completion','skip') returning id`);
  const gen1 = await op(c, env("RecurringInstanceGenerated", { key: "gen-A", deltas: { title: "Weekly", status: "scheduled", owner_user_id: U.admin1, scheduled_date: "2026-08-17", recurrence_definition_id: defId, occurrence_slot: "2026-08-17" }, events: [evt("RecurringInstanceGenerated")] }));
  check("first generation applied (new instance)", gen1.res.outcome === "applied");
  const gen2 = await op(c, env("RecurringInstanceGenerated", { key: "gen-B", deltas: { title: "Weekly", status: "scheduled", owner_user_id: U.admin1, scheduled_date: "2026-08-17", recurrence_definition_id: defId, occurrence_slot: "2026-08-17" }, events: [evt("RecurringInstanceGenerated")] }));
  check("duplicate (definition,slot) with a DIFFERENT key → accepted_noop, no new task", gen2.res.outcome === "accepted_noop" && gen2.res.result_task_id === gen1.res.result_task_id && (await scalar(c, `select count(*)::int from public.tasks where recurrence_definition_id='${defId}' and occurrence_slot='2026-08-17'`)) === 1);

  // ── Append-only enforcement still holds against everyone ───────────────────
  console.log("\n── Append-only enforcement ──");
  check("service_role cannot UPDATE task_events", await (async () => { await c.query("set role service_role"); try { await c.query(`update public.task_events set payload='{}'::jsonb where task_id='${tid}'`); await c.query("reset role"); return false; } catch { await c.query("reset role").catch(() => {}); return true; } })());
  check("service_role cannot DELETE task_events", await (async () => { await c.query("set role service_role"); try { await c.query(`delete from public.task_events where task_id='${tid}'`); await c.query("reset role"); return false; } catch { await c.query("reset role").catch(() => {}); return true; } })());

  // ── Redaction overlay (target byte-identical, no task-event) ────────────────
  console.log("\n── Redaction overlay ──");
  const targetEv = await scalar(c, `select event_id from public.task_events where task_id='${tid}' limit 1`);
  const beforeEv = await scalar(c, `select md5(t.*::text) from public.task_events t where event_id='${targetEv}'`);
  const evCountBefore = await scalar(c, `select count(*)::int from public.task_events where task_id='${tid}'`);
  await c.query("set role service_role");
  const red = await c.query("select public.apply_event_redaction($1::jsonb) res", [JSON.stringify({ workspace_id: WS1, target_event_id: targetEv, redacted_fields: ["title"], mode: "suppress", reason: "PII", actor: { actor_user_id: U.admin1, actor_display: "Eloff" } })]);
  await c.query("reset role");
  check("redaction overlay row created", (await scalar(c, `select count(*)::int from public.event_redactions where target_event_id='${targetEv}'`)) === 1);
  check("target task_events row is byte-identical after redaction", (await scalar(c, `select md5(t.*::text) from public.task_events t where event_id='${targetEv}'`)) === beforeEv);
  check("redaction emitted NO task-event (overlay is the audit)", (await scalar(c, `select count(*)::int from public.task_events where task_id='${tid}'`)) === evCountBefore);
  check("authenticated CANNOT execute redaction op", await (async () => { try { await c.query("begin"); await c.query("set local role authenticated"); await c.query("select public.apply_event_redaction($1::jsonb)", [JSON.stringify({ workspace_id: WS1, subject_kind: "person", subject_ref: "x", redacted_fields: ["a"], mode: "suppress", reason: "r", actor: {} })]); await c.query("rollback"); return false; } catch (e) { await c.query("rollback").catch(() => {}); return e.code === "42501"; } })());

  // ── Concurrency: replay / completion / duplicate-key ───────────────────────
  console.log("\n── Concurrency ──");
  // (1) Concurrent replay of an already-committed receipt → both replay, no writes.
  const cr = await makeScheduled(c);
  await op(c, env("StartTask", { key: "creplay", task_id: cr.id, ver: 3, deltas: { status: "in_progress", assignee_id: U.admin1 }, events: [evt("TaskStarted")] }));
  await c.query("begin"); await c.query("set role service_role");
  await c2.query("begin"); await c2.query("set role service_role");
  const r1 = await c.query("select public.apply_task_command($1::jsonb) res", [JSON.stringify(env("StartTask", { key: "creplay", task_id: cr.id, ver: 3, deltas: { status: "in_progress", assignee_id: U.admin1 }, events: [evt("TaskStarted")] }))]);
  const r2 = await c2.query("select public.apply_task_command($1::jsonb) res", [JSON.stringify(env("StartTask", { key: "creplay", task_id: cr.id, ver: 3, deltas: { status: "in_progress", assignee_id: U.admin1 }, events: [evt("TaskStarted")] }))]);
  await c.query("commit"); await c.query("reset role"); await c2.query("commit"); await c2.query("reset role");
  check("concurrent replay: both return 'replayed', receipt stays single", r1.rows[0].res.outcome === "replayed" && r2.rows[0].res.outcome === "replayed" && (await scalar(c, `select count(*)::int from public.command_receipts where idempotency_key='creplay'`)) === 1);

  // (2) Concurrent completion (different keys, same version) → exactly one wins.
  const cc = await makeInProgress(c);
  await c.query("begin"); await c.query("set role service_role");
  await c.query("select public.apply_task_command($1::jsonb)", [JSON.stringify(env("CompleteTask", { key: "cc1", task_id: cc.id, ver: 4, deltas: { status: "completed" }, events: [evt("TaskCompleted")] }))]);
  await c2.query("begin"); await c2.query("set role service_role");
  const pend = c2.query("select public.apply_task_command($1::jsonb)", [JSON.stringify(env("CompleteTask", { key: "cc2", task_id: cc.id, ver: 4, deltas: { status: "completed" }, events: [evt("TaskCompleted")] }))]);
  pend.catch(() => {}); // register a handler at creation so the EXPECTED rejection is never momentarily "unhandled" while we await the commit below; `await pend` still observes the original outcome
  await c.query("commit"); await c.query("reset role");
  let ccErr = null; try { await pend; } catch (e) { ccErr = e; }
  await c2.query("rollback").catch(() => {}); await c2.query("reset role").catch(() => {});
  check("concurrent completion: the second is blocked then VersionConflicts", ccErr && ccErr.code === "BB460");
  check("concurrent completion: task completed exactly once (v=5, one TaskCompleted)", (await scalar(c, `select aggregate_version from public.tasks where id='${cc.id}'`)) === 5 && (await scalar(c, `select count(*)::int from public.task_events where task_id='${cc.id}' and event_type='TaskCompleted'`)) === 1);

  // (3) Concurrent duplicate-key create → exactly one task + one receipt. The
  // loser legitimately resolves EITHER way and both preserve exactly-once: its
  // own receipt insert can race into the unique constraint (23505), OR — once the
  // winner has committed its receipt — it observes that receipt and returns the
  // committed result as 'replayed'. Which branch fires depends purely on
  // scheduling, so asserting ONLY 23505 was an over-specification that flaked.
  // When the loser replays it must hand back the WINNER's committed result (same
  // task id, the stored receipt's version) — never a second task/receipt/event.
  await c.query("begin"); await c.query("set role service_role");
  const dupWin = await c.query("select public.apply_task_command($1::jsonb) res", [JSON.stringify(env("CaptureTask", { key: "dupcreate", deltas: { title: "DUPTAG", status: "inbox" }, events: [evt("TaskCaptured")] }))]);
  const dupWinTask = dupWin.rows[0].res.result_task_id;
  await c2.query("begin"); await c2.query("set role service_role");
  const pend2 = c2.query("select public.apply_task_command($1::jsonb) res", [JSON.stringify(env("CaptureTask", { key: "dupcreate", deltas: { title: "DUPTAG", status: "inbox" }, events: [evt("TaskCaptured")] }))]);
  pend2.catch(() => {}); // register a handler at creation (see note above); `await pend2` still observes the original outcome
  await c.query("commit"); await c.query("reset role");
  let dupErr = null, dupLoser = null; try { const r = await pend2; dupLoser = r.rows[0].res; } catch (e) { dupErr = e; }
  await c2.query("rollback").catch(() => {}); await c2.query("reset role").catch(() => {});
  const dupReceiptTask = await scalar(c, `select result_task_id from public.command_receipts where idempotency_key='dupcreate'`);
  const dupReceiptVer = await scalar(c, `select result_aggregate_version from public.command_receipts where idempotency_key='dupcreate'`);
  const dupLostBy23505 = Boolean(dupErr) && dupErr.code === "23505";
  const dupLostByReplay = !dupErr && Boolean(dupLoser) && dupLoser.outcome === "replayed";
  check("concurrent duplicate-key create: loser resolves as unique-violation (23505) OR replays the committed result", dupLostBy23505 || dupLostByReplay, dupErr ? `err ${dupErr.code}` : `outcome ${dupLoser && dupLoser.outcome}`);
  check("concurrent duplicate-key create: a replaying loser returns the winner's committed task + stored receipt version", !dupLostByReplay || (dupLoser.result_task_id === dupWinTask && dupLoser.result_task_id === dupReceiptTask && dupLoser.result_aggregate_version === dupReceiptVer));
  check("concurrent duplicate-key create: exactly one task + one receipt + one event (both outcomes)", (await scalar(c, `select count(*)::int from public.tasks where title='DUPTAG'`)) === 1 && (await scalar(c, `select count(*)::int from public.command_receipts where idempotency_key='dupcreate'`)) === 1 && (await scalar(c, `select count(*)::int from public.task_events where task_id='${dupWinTask}'`)) === 1);

  // ── Cross-workspace reference is structurally impossible ───────────────────
  console.log("\n── Cross-workspace ──");
  const xTask = await makePlanned(c);
  const xw = await op(c, env("CaptureTask", { deltas: { title: "child", status: "inbox", parent_id: xTask.id }, ws: WS2, actor: { actor_kind: "user", actor_user_id: U.admin3, actor_display: "WS2" }, events: [evt("TaskCaptured")] }));
  check("cross-workspace parent_id rejected (composite FK)", xw.error !== null && xw.error.code === "23503");

  // ── Composition: prior slices intact ───────────────────────────────────────
  console.log("\n── Composition ──");
  check("tasks + task_events + command_receipts + functions present after chain", (await scalar(c, `select count(*)::int from information_schema.tables where table_schema='public' and table_name in ('tasks','task_events','command_receipts')`)) === 3 && (await scalar(c, `select count(*)::int from pg_proc where proname in ('apply_task_command','apply_event_redaction')`)) === 2);

  await c.end(); await c2.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0046 INTERNAL PERSISTENCE CHECKS: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
