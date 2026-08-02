/**
 * Bbettr OS — Migration 0040 (labels + task_labels) proof.
 *
 * Runs the REAL 0040_planner_labels.sql (on top of 0036–0039) against a
 * disposable local PostgreSQL and exhaustively verifies: structure, color/name
 * values, full case-insensitive name uniqueness, label lifecycle (rename/recolor/
 * archive/immutability), task associations (composite FKs, archived resolvability,
 * immutability), RLS, boundary, and chain composition.
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
const PALETTE = ["gray","red","orange","amber","green","teal","blue","indigo","purple","pink"];
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1",
  admin3: "00000000-0000-0000-0000-0000000000a3",
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
  none: "00000000-0000-0000-0000-0000000000f1",
};
const TA = "00000000-0000-0000-0000-00000000a001"; // WS1 task
const TW = "00000000-0000-0000-0000-00000000b001"; // WS2 task

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0040: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0040: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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

async function insLabel(c, cols = {}) {
  const merged = { workspace_id: WS1, name: "L", color_token: "blue", ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.labels (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`, keys.map((k) => merged[k]));
}
async function insTL(c, cols = {}) {
  const merged = { workspace_id: WS1, task_id: TA, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.task_labels (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of ["0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql","0039_planner_task_dependencies.sql","0040_planner_labels.sql"])
    await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
  await c.query(`insert into public.tasks (id,workspace_id,title,created_by) values ('${TA}','${WS1}','A','${U.admin1}'),('${TW}','${WS2}','W','${U.admin1}')`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure — labels ─────────────────────────────────────────────────────
  console.log("\n── Structure — labels ──");
  check("labels table exists", (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='labels' and table_type='BASE TABLE'`)).rows.length === 1);
  check("labels exact columns", (await scalar(c, `select array_agg(column_name order by column_name)::text from information_schema.columns where table_schema='public' and table_name='labels'`)) === "{archived_at,color_token,created_at,id,name,workspace_id}");
  check("labels PK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.labels'::regclass and contype='p'`)) === 1);
  check("labels workspace FK present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.labels'::regclass and contype='f'`)) === 1);
  check("labels unique (workspace_id,id) present", (await scalar(c, `select count(*)::int from pg_constraint where conname='labels_workspace_id_unique' and contype='u'`)) === 1);
  check("functional unique (workspace_id,lower(name)) present", (await scalar(c, `select count(*)::int from pg_indexes where indexname='labels_workspace_lower_name_idx' and indexdef ilike '%lower(name)%'`)) === 1);
  check("active-label picker index present", (await scalar(c, `select count(*)::int from pg_indexes where indexname='labels_active_idx' and indexdef ilike '%where (archived_at is null)%'`)) === 1);
  check("name + color CHECKs present", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.labels'::regclass and contype='c' and conname in ('labels_name_nonempty','labels_color_token_valid')`)) === 2);
  check("labels immutability trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='labels_enforce_immutable' and not tgisinternal`)) === 1);
  check("labels RLS enabled + forced", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.labels'::regclass`)) === true);

  // ── Structure — task_labels ────────────────────────────────────────────────
  console.log("\n── Structure — task_labels ──");
  check("task_labels table exists", (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_labels' and table_type='BASE TABLE'`)).rows.length === 1);
  check("task_labels exact 3 columns", (await scalar(c, `select array_agg(column_name order by column_name)::text from information_schema.columns where table_schema='public' and table_name='task_labels'`)) === "{label_id,task_id,workspace_id}");
  check("task_labels composite PK (task_id,label_id)", (await scalar(c, `select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.task_labels'::regclass and contype='p'`)) === "PRIMARY KEY (task_id, label_id)");
  check("both composite FKs present (task + label)", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.task_labels'::regclass and contype='f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id,%'`)) === 2);
  check("label_id index present", (await scalar(c, `select count(*)::int from pg_indexes where indexname='task_labels_label_idx'`)) === 1);
  check("task_labels immutability trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='task_labels_enforce_immutable' and not tgisinternal`)) === 1);
  check("task_labels RLS enabled + forced", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.task_labels'::regclass`)) === true);

  // ── Label values ───────────────────────────────────────────────────────────
  console.log("\n── Label values ──");
  let allTokens = true;
  for (let i = 0; i < PALETTE.length; i++) if ((await insLabel(c, { name: `tok-${PALETTE[i]}`, color_token: PALETTE[i] })).error !== null) allTokens = false;
  check("every approved color token accepted", allTokens);
  check("unknown color token rejected", (await insLabel(c, { name: "bad", color_token: "success" })).error !== null);
  check("hex color token rejected", (await insLabel(c, { name: "hex", color_token: "#ff0000" })).error !== null);
  check("empty name rejected", (await insLabel(c, { name: "" })).error !== null);
  check("whitespace-only name rejected", (await insLabel(c, { name: "   " })).error !== null);
  check("valid trimmed name accepted", (await insLabel(c, { name: "Design" })).error === null);

  // ── Name uniqueness ────────────────────────────────────────────────────────
  console.log("\n── Name uniqueness (full, case-insensitive) ──");
  await insLabel(c, { name: "Urgent" });
  check("Urgent vs urgent conflict in same workspace", (await insLabel(c, { name: "urgent" })).error !== null);
  check("same name accepted in another workspace", (await insLabel(c, { workspace_id: WS2, name: "Urgent" })).error === null);
  const arch = (await insLabel(c, { name: "Legacy" })).rows[0].id;
  await c.query(`update public.labels set archived_at=now() where id='${arch}'`);
  check("archived label still reserves its name", (await insLabel(c, { name: "legacy" })).error !== null);
  await c.query(`update public.labels set name='Legacy-Retired' where id='${arch}'`);
  check("renamed archived label frees its former name", (await insLabel(c, { name: "Legacy" })).error === null);

  // ── Label lifecycle ────────────────────────────────────────────────────────
  console.log("\n── Label lifecycle ──");
  const lc = (await insLabel(c, { name: "Lifecycle", color_token: "blue" })).rows[0].id;
  await c.query(`update public.labels set name='Lifecycle-2' where id='${lc}'`);
  check("rename succeeds", (await scalar(c, `select name from public.labels where id='${lc}'`)) === "Lifecycle-2");
  await c.query(`update public.labels set color_token='green' where id='${lc}'`);
  check("recolour succeeds", (await scalar(c, `select color_token from public.labels where id='${lc}'`)) === "green");
  await c.query(`update public.labels set archived_at=now() where id='${lc}'`);
  check("archive succeeds + row retained", (await scalar(c, `select archived_at is not null from public.labels where id='${lc}'`)) === true);
  await c.query(`update public.labels set id=gen_random_uuid(), workspace_id='${WS2}', created_at=now()-interval '1 year' where id='${lc}'`);
  const held = (await c.query(`select id, workspace_id from public.labels where id='${lc}'`)).rows[0];
  check("id + workspace_id + created_at held immutable", held && held.workspace_id === WS1);

  // ── Task associations ──────────────────────────────────────────────────────
  console.log("\n── Task associations ──");
  const L1 = (await insLabel(c, { name: "Assoc1" })).rows[0].id;
  const LW2 = (await insLabel(c, { workspace_id: WS2, name: "WS2Label" })).rows[0].id;
  check("valid same-workspace association accepted", (await insTL(c, { task_id: TA, label_id: L1 })).error === null);
  check("duplicate (task,label) association rejected", (await insTL(c, { task_id: TA, label_id: L1 })).error !== null);
  check("nonexistent task rejected", (await insTL(c, { task_id: "00000000-0000-0000-0000-0000000000ee", label_id: L1 })).error !== null);
  check("nonexistent label rejected", (await insTL(c, { task_id: TA, label_id: "00000000-0000-0000-0000-0000000000ee" })).error !== null);
  check("cross-workspace task rejected", (await insTL(c, { workspace_id: WS1, task_id: TW, label_id: L1 })).error !== null);
  check("cross-workspace label rejected", (await insTL(c, { workspace_id: WS1, task_id: TA, label_id: LW2 })).error !== null);
  // archived label remains a valid association target
  const LArch = (await insLabel(c, { name: "ArchTarget" })).rows[0].id;
  await c.query(`update public.labels set archived_at=now() where id='${LArch}'`);
  check("association to an ARCHIVED label accepted (valid FK target)", (await insTL(c, { task_id: TA, label_id: LArch })).error === null);
  // archiving a label with an existing association keeps it + resolvable
  const LKeep = (await insLabel(c, { name: "KeepAssoc" })).rows[0].id;
  await c.query(`insert into public.task_labels (workspace_id,task_id,label_id) values ('${WS1}','${TA}','${LKeep}')`);
  await c.query(`update public.labels set archived_at=now() where id='${LKeep}'`);
  check("archiving a label does NOT delete existing associations",
    (await scalar(c, `select count(*)::int from public.task_labels where label_id='${LKeep}'`)) === 1);
  check("archived label resolvable through join",
    (await scalar(c, `select l.archived_at is not null from public.task_labels tl join public.labels l on l.id=tl.label_id where tl.label_id='${LKeep}'`)) === true);
  // association identity immutable
  await c.query(`update public.task_labels set workspace_id='${WS2}', task_id='${TW}', label_id='${LW2}' where task_id='${TA}' and label_id='${L1}'`);
  check("association identity fields held immutable",
    (await scalar(c, `select count(*)::int from public.task_labels where task_id='${TA}' and label_id='${L1}' and workspace_id='${WS1}'`)) === 1);

  // ── RLS ────────────────────────────────────────────────────────────────────
  console.log("\n── RLS ──");
  check("admin1 sees WS1 label", (await runAs(c, "authenticated", U.admin1, `select 1 from public.labels where id='${L1}'`)).rowCount === 1);
  check("admin1 does NOT see WS2 label", (await runAs(c, "authenticated", U.admin1, `select 1 from public.labels where id='${LW2}'`)).rowCount === 0);
  check("admin1 sees WS1 association", (await runAs(c, "authenticated", U.admin1, `select 1 from public.task_labels where task_id='${TA}' and label_id='${L1}'`)).rowCount === 1);
  check("admin3 (WS2) sees only WS2 labels", (await runAs(c, "authenticated", U.admin3, `select distinct workspace_id from public.labels`)).rows.every((r) => r.workspace_id === WS2));
  check("client sees ZERO labels", (await runAs(c, "authenticated", U.client, `select * from public.labels`)).rowCount === 0);
  check("rep sees ZERO task_labels", (await runAs(c, "authenticated", U.rep, `select * from public.task_labels`)).rowCount === 0);
  check("anon sees ZERO labels", denied(await runAs(c, "anon", null, `select * from public.labels`)));
  check("admin cannot INSERT label", denied(await runAs(c, "authenticated", U.admin1, `insert into public.labels (workspace_id,name,color_token) values ('${WS1}','X','red')`)));
  check("admin cannot UPDATE label", denied(await runAs(c, "authenticated", U.admin1, `update public.labels set name='hax' where id='${L1}'`)));
  check("admin cannot DELETE label", denied(await runAs(c, "authenticated", U.admin1, `delete from public.labels where id='${L1}'`)));
  check("admin cannot INSERT task_label", denied(await runAs(c, "authenticated", U.admin1, `insert into public.task_labels (workspace_id,task_id,label_id) values ('${WS1}','${TA}','${L1}')`)));
  check("admin cannot DELETE task_label", denied(await runAs(c, "authenticated", U.admin1, `delete from public.task_labels where task_id='${TA}' and label_id='${L1}'`)));
  check("service_role can write labels", (await runAs(c, "service_role", null, `insert into public.labels (workspace_id,name,color_token) values ('${WS1}','SR','pink')`)).error === null);

  // ── Boundary ───────────────────────────────────────────────────────────────
  console.log("\n── Boundary ──");
  check("public.tasks trigger count unchanged (0037's two)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal`)) === 2);
  check("task_blockers trigger count unchanged (0038's one)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.task_blockers'::regclass and not tgisinternal`)) === 1);
  check("task_dependencies trigger count unchanged (0039's two)", (await scalar(c, `select count(*)::int from pg_trigger where tgrelid='public.task_dependencies'::regclass and not tgisinternal`)) === 2);
  const absent = async (t) => (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [t])).rows.length === 0;
  check("no TaskLabeled/TaskUnlabeled events (no task_events yet)", await absent("task_events"));
  check("no 0041–0047 objects", (await absent("recurring_definitions")) && (await absent("task_reminders")) && (await absent("event_redactions")) && (await absent("command_receipts")));

  // ── Composition ────────────────────────────────────────────────────────────
  console.log("\n── Composition: real 0027–0040 chain ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  for (const f of ["0027_planner_tasks.sql","0028_calendar_credentials.sql","0029_meetings.sql","0030_meeting_attendees.sql",
    "0031_calendar_projections.sql","0032_meetings_idempotency.sql","0033_create_meeting_rpc.sql","0034_soft_delete_meeting.sql",
    "0035_planner_tasks_supersede_legacy.sql","0036_planner_workspaces.sql","0037_planner_tasks_core.sql","0038_planner_task_blockers.sql",
    "0039_planner_task_dependencies.sql","0040_planner_labels.sql"]) {
    const r = await tryQuery(c, sqlFile(f));
    if (r.error) { chainErr = `${f}: ${r.error.message}`; break; }
  }
  check("full 0027–0040 chain applies without collision", chainErr === null, chainErr ?? "");
  check("labels + task_labels + tasks + meetings present after chain",
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='labels'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='task_labels'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='tasks'`)).rows.length === 1 &&
    (await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='meetings'`)).rows.length === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0040 LABELS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
