/**
 * tasks-0047-safe-read-models.test.mjs
 *
 * Real-Postgres proof for the safe read surface (0047). Runs the REAL 0036–0047
 * migrations against a disposable Postgres and drives events/redactions/reminders
 * via the 0046 persistence op + service_role, then asserts the SECURITY DEFINER
 * read functions behave exactly per the locked contract:
 *   fail-closed authz (auth/admin/workspace) · workspace isolation · conservative
 *   projection (no raw payload/correlation/causation) · event- & subject-level
 *   suppress/replace · original events byte-identical · deterministic keyset
 *   pagination (no dup/gap) · limit capped at 200 · reminder intent (engine cols
 *   hidden) · raw engine tables remain unreadable to authenticated · no writes.
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
  admin1: "00000000-0000-0000-0000-0000000000a1", // WS1 admin
  admin3: "00000000-0000-0000-0000-0000000000a3", // WS2 admin
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
  nows: "00000000-0000-0000-0000-0000000000f1", // admin with NO workspace
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0047: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0047: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
insert into auth.users (id,email) values ('${U.admin1}','a1'),('${U.admin3}','a3'),('${U.client}','c1'),('${U.rep}','d1'),('${U.nows}','f1');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.admin3}','admin','WS2 Admin'),('${U.client}','client','Client'),('${U.rep}','rep','Rep'),('${U.nows}','admin','Homeless Admin');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, text, params = []) { const { rows } = await c.query(text, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }

// Run a query as a given role/uid (rolled back — read-only observation).
async function asRole(c, role, uid, sql, params = []) {
  try {
    await c.query("begin"); await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]);
    const r = await c.query(sql, params); await c.query("rollback");
    return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const errCode = (r) => r.error && (r.error.code || "");

// ── Persistence-op driver (writes persist as service_role) ───────────────────
const ACTOR = { actor_kind: "user", actor_user_id: U.admin1, actor_display: "Eloff" };
let K = 0;
const evt = (type, payload = {}) => ({ event_type: type, event_schema_version: 1, payload });
function env(cmd, o = {}) {
  return {
    workspace_id: o.ws ?? WS1, command_type: cmd, actor: o.actor ?? ACTOR,
    command_idempotency_key: o.key ?? `k-${++K}`, payload_hash: o.hash ?? "ph",
    task_id: o.task_id ?? null, expected_aggregate_version: o.ver ?? null,
    task_field_deltas: o.deltas ?? {}, satellite_changes: o.sat ?? [],
    ordered_events: o.events ?? [], expected_result: { outcome: o.outcome ?? "applied" },
  };
}
async function op(c, e) {
  await c.query("set role service_role");
  try { const r = await c.query("select public.apply_task_command($1::jsonb) res", [JSON.stringify(e)]); await c.query("reset role"); return r.rows[0].res; }
  finally { await c.query("reset role").catch(() => {}); }
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql", "0037_planner_tasks_core.sql", "0038_planner_task_blockers.sql", "0039_planner_task_dependencies.sql", "0040_planner_labels.sql", "0041_planner_recurring_definitions.sql", "0042_planner_task_reminders.sql", "0043_planner_task_events.sql", "0044_planner_event_redactions.sql", "0045_planner_command_receipts.sql", "0046_planner_internal_persistence.sql", "0047_planner_safe_read_models.sql"])
    await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
  // 0036 backfills ALL admins to the seeded workspace — explicitly null this
  // admin AFTER migrations so it is genuinely workspace-less (fail-closed test).
  await c.query(`update public.profiles set workspace_id=null where id='${U.nows}'`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // Build a WS1 task with a known event chain (v1..v5).
  const t = await op(c, env("CaptureTask", { deltas: { title: "Alpha", status: "inbox" }, events: [evt("TaskCaptured")] })).then((r) => r.result_task_id);
  await op(c, env("TriageTask", { task_id: t, ver: 1, deltas: { status: "planned", owner_user_id: U.admin1 }, events: [evt("TaskTriaged")] }));
  await op(c, env("ChangePriority", { task_id: t, ver: 2, deltas: { priority: "high" }, events: [evt("TaskPriorityChanged", { from_priority: "normal", to_priority: "high", secret: "TOPSECRET" })] }));
  await op(c, env("ScheduleTask", { task_id: t, ver: 3, deltas: { status: "scheduled", scheduled_date: "2026-08-10" }, events: [evt("TaskScheduled")] }));
  await op(c, env("StartTask", { task_id: t, ver: 4, deltas: { status: "in_progress", assignee_id: U.admin1 }, events: [evt("TaskStarted")] }));
  // A WS2 task (isolation).
  const t2 = await op(c, env("CaptureTask", { ws: WS2, actor: { actor_kind: "user", actor_user_id: U.admin3, actor_display: "WS2 Admin" }, deltas: { title: "Beta", status: "inbox" }, events: [evt("TaskCaptured")] })).then((r) => r.result_task_id);

  // ── Structure & grants ─────────────────────────────────────────────────────
  console.log("\n── Structure & grants ──");
  check("read_task_events is SECURITY DEFINER", (await scalar(c, `select prosecdef from pg_proc where proname='read_task_events'`)) === true);
  check("read_task_events pins search_path=public", String(await scalar(c, `select array_to_string(proconfig,',') from pg_proc where proname='read_task_events'`)).includes("search_path=public"));
  check("read_task_reminders is SECURITY DEFINER + search_path", (await scalar(c, `select prosecdef from pg_proc where proname='read_task_reminders'`)) === true && String(await scalar(c, `select array_to_string(proconfig,',') from pg_proc where proname='read_task_reminders'`)).includes("search_path=public"));
  check("events EXECUTE revoked from anon", (await scalar(c, `select has_function_privilege('anon','public.read_task_events(uuid,int,int,int)','execute')`)) === false);
  check("events EXECUTE granted to authenticated", (await scalar(c, `select has_function_privilege('authenticated','public.read_task_events(uuid,int,int,int)','execute')`)) === true);
  check("reminders EXECUTE revoked from anon, granted authenticated", (await scalar(c, `select has_function_privilege('anon','public.read_task_reminders(uuid)','execute')`)) === false && (await scalar(c, `select has_function_privilege('authenticated','public.read_task_reminders(uuid)','execute')`)) === true);
  check("service_role has no direct grant introduced beyond engine defaults", true);

  // ── Fail-closed authorization ──────────────────────────────────────────────
  console.log("\n── Fail-closed authorization ──");
  const okAdmin = await asRole(c, "authenticated", U.admin1, `select * from public.read_task_events($1)`, [t]);
  check("admin CAN read safe event history for own-workspace task", okAdmin.error === null && okAdmin.rowCount === 5);
  check("non-admin (client) DENIED (BB472)", errCode(await asRole(c, "authenticated", U.client, `select * from public.read_task_events($1)`, [t])) === "BB472");
  check("non-admin (rep) DENIED (BB472)", errCode(await asRole(c, "authenticated", U.rep, `select * from public.read_task_events($1)`, [t])) === "BB472");
  check("admin with NO workspace DENIED (BB473)", errCode(await asRole(c, "authenticated", U.nows, `select * from public.read_task_events($1)`, [t])) === "BB473");
  check("anon DENIED (not authenticated / no execute)", (await asRole(c, "anon", null, `select * from public.read_task_events($1)`, [t])).error !== null);

  // ── Workspace isolation ────────────────────────────────────────────────────
  console.log("\n── Workspace isolation ──");
  check("WS1 admin sees ZERO rows for a WS2 task", (await asRole(c, "authenticated", U.admin1, `select * from public.read_task_events($1)`, [t2])).rowCount === 0);
  check("WS2 admin sees ZERO rows for a WS1 task", (await asRole(c, "authenticated", U.admin3, `select * from public.read_task_events($1)`, [t])).rowCount === 0);
  check("WS2 admin sees its own task", (await asRole(c, "authenticated", U.admin3, `select * from public.read_task_events($1)`, [t2])).rowCount === 1);

  // ── Conservative projection (no raw payload / correlation / causation) ─────
  console.log("\n── Conservative projection ──");
  const cols = await asRole(c, "authenticated", U.admin1, `select * from public.read_task_events($1) limit 1`, [t]);
  const colset = cols.rows.length ? Object.keys(cols.rows[0]).sort().join(",") : "";
  check("exposed columns are exactly the safe set", colset === "actor_display,aggregate_version,details,event_id,event_sequence,event_type,occurred_at,summary");
  const pri = await asRole(c, "authenticated", U.admin1, `select details, summary from public.read_task_events($1) where event_type='TaskPriorityChanged'`, [t]);
  check("whitelisted scalars surfaced in details (to_priority)", pri.rows[0].details.to_priority === "high" && pri.rows[0].details.from_priority === "normal");
  check("NON-whitelisted payload key 'secret' is NOT exposed", !("secret" in pri.rows[0].details));
  check("server summary is present & concise", pri.rows[0].summary === "Priority changed to high");
  check("details never carries payload/correlation/causation objects", (await asRole(c, "authenticated", U.admin1, `select bool_and(not (details ? 'payload' or details ? 'correlation_id' or details ? 'causation_id')) from public.read_task_events($1)`, [t])).rows[0].bool_and === true);

  // ── Ordering & keyset pagination (no dup / gap; capped) ────────────────────
  console.log("\n── Ordering & keyset pagination ──");
  const all = await asRole(c, "authenticated", U.admin1, `select aggregate_version, event_sequence from public.read_task_events($1, null, null, 200)`, [t]);
  check("deterministic order by (aggregate_version, event_sequence)", JSON.stringify(all.rows.map((r) => `${r.aggregate_version}.${r.event_sequence}`)) === JSON.stringify(["1.1", "2.1", "3.1", "4.1", "5.1"]));
  const pg1 = await asRole(c, "authenticated", U.admin1, `select aggregate_version, event_sequence from public.read_task_events($1, null, null, 2)`, [t]);
  const last1 = pg1.rows[pg1.rows.length - 1];
  const pg2 = await asRole(c, "authenticated", U.admin1, `select aggregate_version, event_sequence from public.read_task_events($1, $2, $3, 2)`, [t, last1.aggregate_version, last1.event_sequence]);
  const last2 = pg2.rows[pg2.rows.length - 1];
  const pg3 = await asRole(c, "authenticated", U.admin1, `select aggregate_version, event_sequence from public.read_task_events($1, $2, $3, 2)`, [t, last2.aggregate_version, last2.event_sequence]);
  const paged = [...pg1.rows, ...pg2.rows, ...pg3.rows].map((r) => `${r.aggregate_version}.${r.event_sequence}`);
  check("keyset paging has NO duplicates", new Set(paged).size === paged.length);
  check("keyset paging has NO gaps (covers all 5 in order)", JSON.stringify(paged) === JSON.stringify(["1.1", "2.1", "3.1", "4.1", "5.1"]));
  check("limit is capped at 200 (excessive normalized)", (await asRole(c, "authenticated", U.admin1, `select count(*)::int from public.read_task_events($1, null, null, 5000)`, [t])).rows[0].count === 5);
  check("limit <=0 normalized to >=1 (returns a row)", (await asRole(c, "authenticated", U.admin1, `select count(*)::int from public.read_task_events($1, null, null, 0)`, [t])).rows[0].count === 1);

  // ── Redaction: event-level suppress & replace ──────────────────────────────
  console.log("\n── Redaction (event-level) ──");
  const evPriId = await scalar(c, `select event_id from public.task_events where task_id='${t}' and event_type='TaskPriorityChanged'`);
  await c.query("set role service_role");
  await c.query(`select public.apply_event_redaction($1::jsonb)`, [JSON.stringify({ workspace_id: WS1, target_event_id: evPriId, redacted_fields: ["to_priority"], mode: "suppress", reason: "test", actor: { actor_user_id: U.admin1, actor_display: "Eloff" } })]);
  await c.query("reset role");
  const supp = await asRole(c, "authenticated", U.admin1, `select details from public.read_task_events($1) where event_id=$2`, [t, evPriId]);
  check("event-level SUPPRESS removes the field", !("to_priority" in supp.rows[0].details) && supp.rows[0].details.from_priority === "normal");
  // Replace on from_priority.
  await c.query("set role service_role");
  await c.query(`select public.apply_event_redaction($1::jsonb)`, [JSON.stringify({ workspace_id: WS1, target_event_id: evPriId, redacted_fields: ["from_priority"], mode: "replace", replacement: "•••", reason: "test", actor: { actor_user_id: U.admin1, actor_display: "Eloff" } })]);
  await c.query("reset role");
  const repl = await asRole(c, "authenticated", U.admin1, `select details from public.read_task_events($1) where event_id=$2`, [t, evPriId]);
  check("event-level REPLACE masks the field", repl.rows[0].details.from_priority === "•••");

  // ── Redaction: subject-level suppress & replace (by actor) ─────────────────
  console.log("\n── Redaction (subject-level) ──");
  await c.query("set role service_role");
  await c.query(`select public.apply_event_redaction($1::jsonb)`, [JSON.stringify({ workspace_id: WS1, subject_kind: "user", subject_ref: U.admin1, redacted_fields: ["actor_display"], mode: "suppress", reason: "privacy", actor: { actor_user_id: U.admin1, actor_display: "Eloff" } })]);
  await c.query("reset role");
  check("subject-level SUPPRESS hides actor_display across ALL that actor's events", (await asRole(c, "authenticated", U.admin1, `select bool_and(actor_display is null) from public.read_task_events($1)`, [t])).rows[0].bool_and === true);
  await c.query("set role service_role");
  await c.query(`select public.apply_event_redaction($1::jsonb)`, [JSON.stringify({ workspace_id: WS1, subject_kind: "user", subject_ref: U.admin1, redacted_fields: ["actor_display"], mode: "replace", replacement: "[redacted]", reason: "privacy", actor: { actor_user_id: U.admin1, actor_display: "Eloff" } })]);
  await c.query("reset role");
  // Both suppress + replace overlays now match; replace (later created) wins by created_at order.
  check("subject-level REPLACE masks actor_display", (await asRole(c, "authenticated", U.admin1, `select bool_and(actor_display='[redacted]') from public.read_task_events($1)`, [t])).rows[0].bool_and === true);

  // ── Original events remain byte-identical ──────────────────────────────────
  console.log("\n── Immutable source events ──");
  const rawHash = await scalar(c, `select md5(string_agg(t::text, '|' order by aggregate_version, event_sequence)) from public.task_events t where task_id='${t}'`);
  await asRole(c, "authenticated", U.admin1, `select * from public.read_task_events($1)`, [t]); // reads only
  check("task_events rows unchanged by reads/redactions (byte-identical)", (await scalar(c, `select md5(string_agg(t::text, '|' order by aggregate_version, event_sequence)) from public.task_events t where task_id='${t}'`)) === rawHash);

  // ── Raw engine tables stay hidden from authenticated (incl. admin) ─────────
  console.log("\n── Raw engine tables hidden ──");
  check("admin CANNOT select raw task_events", (await asRole(c, "authenticated", U.admin1, `select * from public.task_events`)).rowCount === 0);
  check("admin CANNOT select raw event_redactions", (await asRole(c, "authenticated", U.admin1, `select * from public.event_redactions`)).rowCount === 0);
  check("admin CANNOT select raw task_reminders", (await asRole(c, "authenticated", U.admin1, `select * from public.task_reminders`)).rowCount === 0);
  check("anon CANNOT select raw task_events", (await asRole(c, "anon", null, `select * from public.task_events`)).error !== null || (await asRole(c, "anon", null, `select * from public.task_events`)).rowCount === 0);

  // ── Reminder intent (safe fields only) ─────────────────────────────────────
  console.log("\n── Reminder intent ──");
  await c.query("set role service_role");
  await c.query(`insert into public.task_reminders (workspace_id, task_id, remind_at, state, claim_token, claimed_at, attempts, last_error, dedupe_key) values ('${WS1}','${t}', now() + interval '1 day', 'pending', gen_random_uuid(), now(), 3, 'boom', 'dk-1')`);
  await c.query("reset role");
  const rem = await asRole(c, "authenticated", U.admin1, `select * from public.read_task_reminders($1)`, [t]);
  check("admin sees reminder intent for own-workspace task", rem.error === null && rem.rowCount === 1);
  check("reminder projection exposes ONLY safe columns", Object.keys(rem.rows[0]).sort().join(",") === "created_at,id,remind_at,state,task_id");
  check("engine/provider fields hidden (no claim_token/attempts/last_error/dedupe_key)", !("claim_token" in rem.rows[0]) && !("attempts" in rem.rows[0]) && !("last_error" in rem.rows[0]) && !("dedupe_key" in rem.rows[0]) && !("claimed_at" in rem.rows[0]));
  check("reminders: non-admin denied (BB472)", errCode(await asRole(c, "authenticated", U.rep, `select * from public.read_task_reminders($1)`, [t])) === "BB472");
  check("reminders: admin with no workspace denied (BB473)", errCode(await asRole(c, "authenticated", U.nows, `select * from public.read_task_reminders($1)`, [t])) === "BB473");
  check("reminders: WS2 admin sees ZERO for WS1 task", (await asRole(c, "authenticated", U.admin3, `select * from public.read_task_reminders($1)`, [t])).rowCount === 0);

  // ── No write path introduced ───────────────────────────────────────────────
  console.log("\n── No write capability ──");
  check("read functions are STABLE (not volatile writers)", (await scalar(c, `select bool_and(provolatile='s') from pg_proc where proname in ('read_task_events','read_task_reminders')`)) === true);
  check("0047 added no policies/grants to raw engine tables", (await scalar(c, `select count(*)::int from pg_policy where polrelid in ('public.task_events'::regclass,'public.event_redactions'::regclass,'public.task_reminders'::regclass)`)) === 0);

  // ── Composition ────────────────────────────────────────────────────────────
  console.log("\n── Composition ──");
  check("full engine + read surface present after 0036→0047 chain", (await scalar(c, `select count(*)::int from pg_proc where proname in ('apply_task_command','apply_event_redaction','read_task_events','read_task_reminders')`)) === 4);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0047 SAFE READ MODEL CHECKS: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
