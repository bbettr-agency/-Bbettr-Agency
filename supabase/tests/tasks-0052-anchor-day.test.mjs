/**
 * Bbettr OS — Migration 0052 (recurring_definitions.anchor_day) proof.
 *
 * Runs the REAL 0052 on top of the 0036–0041 chain against a disposable local
 * PostgreSQL and verifies the ONE additive column and its constraint, and that
 * NOTHING else about recurring_definitions changed:
 *   - anchor_day column exists, smallint, nullable
 *   - CHECK anchor_day IN [1..31] OR NULL (rejects 0 and 32; accepts null/1/31)
 *   - column count grows by exactly 1 (20 → 21); occurrence_slot key untouched
 *   - RLS still enabled+forced, still SELECT-only (no insert/update/delete policy),
 *     audit trigger + 4 FKs + both evaluator indexes intact
 *   - re-applying 0052 is a no-op (guarded add column + constraint)
 *   - the full 0036–0052 chain applies without collision
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
const CLIENT_ROW = "00000000-0000-0000-0000-0000000000b1";
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0052: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0052: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
insert into auth.users (id,email) values ('${U.admin1}','a1'),('${U.admin3}','a3'),('${U.client}','c1'),('${U.rep}','d1');
insert into public.clients (id) values ('${CLIENT_ROW}');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.admin3}','admin','WS2 Admin'),('${U.client}','client','Client'),('${U.rep}','rep','Rep');
`;

const CHAIN = [
  "0036_planner_workspaces.sql", "0037_planner_tasks_core.sql", "0038_planner_task_blockers.sql",
  "0039_planner_task_dependencies.sql", "0040_planner_labels.sql", "0041_planner_recurring_definitions.sql",
  "0052_recurring_definitions_anchor_day.sql",
];

const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");
let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function tryQuery(c, text, params = []) {
  try { const r = await c.query(text, params); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { return { rows: [], rowCount: 0, error: e }; }
}
async function scalar(c, text, params = []) { const { rows } = await c.query(text, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }

async function insDef(c, cols = {}) {
  const base = { workspace_id: WS1, owner_user_id: U.admin1, template_title: "Monthly invoice", template_priority: "normal",
    rule_interval: 1, rule_unit: "month", mode: "schedule", missed_policy: "skip" };
  const merged = { ...base, ...cols };
  const keys = Object.keys(merged);
  return tryQuery(c, `insert into public.recurring_definitions (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`, keys.map((k) => merged[k]));
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of CHAIN) await c.query(sqlFile(f));
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── The added column ─────────────────────────────────────────────────────
  console.log("\n── anchor_day column ──");
  const col = (await c.query(`select data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='recurring_definitions' and column_name='anchor_day'`)).rows[0];
  check("anchor_day exists", !!col);
  check("anchor_day is smallint", col && col.data_type === "smallint");
  check("anchor_day is nullable", col && col.is_nullable === "YES");
  check("range CHECK constraint present", (await scalar(c, `select count(*)::int from pg_constraint where conname='recurring_definitions_anchor_day_range' and conrelid='public.recurring_definitions'::regclass and contype='c'`)) === 1);
  check("column count grew by exactly 1 (20 → 21)", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='recurring_definitions'`)) === 21);

  // ── Constraint behaviour ─────────────────────────────────────────────────
  console.log("\n── anchor_day constraint ──");
  check("null anchor_day accepted (day/week rules)", (await insDef(c, { rule_unit: "week", anchor_day: null })).error === null);
  check("anchor_day = 1 accepted", (await insDef(c, { anchor_day: 1 })).error === null);
  check("anchor_day = 25 accepted", (await insDef(c, { anchor_day: 25 })).error === null);
  check("anchor_day = 31 accepted", (await insDef(c, { anchor_day: 31 })).error === null);
  check("anchor_day = 0 rejected", (await insDef(c, { anchor_day: 0 })).error !== null);
  check("anchor_day = 32 rejected", (await insDef(c, { anchor_day: 32 })).error !== null);
  check("anchor_day = -1 rejected", (await insDef(c, { anchor_day: -1 })).error !== null);

  // ── Everything else about recurring_definitions unchanged ─────────────────
  console.log("\n── recurring_definitions otherwise unchanged ──");
  check("RLS still enabled + forced", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.recurring_definitions'::regclass`)) === true);
  check("still SELECT-only (exactly one policy, cmd=SELECT)", (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='recurring_definitions'`)) === 1
    && (await scalar(c, `select cmd from pg_policies where schemaname='public' and tablename='recurring_definitions' limit 1`)) === "SELECT");
  check("audit/immutability trigger still present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='recurring_definitions_enforce_audit' and not tgisinternal`)) === 1);
  check("4 FKs intact", (await scalar(c, `select count(*)::int from pg_constraint where conrelid='public.recurring_definitions'::regclass and contype='f'`)) === 4);
  check("both evaluator indexes intact", (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and indexname in ('recurring_definitions_schedule_due_idx','recurring_definitions_active_idx')`)) === 2);

  // ── tasks recurrence key untouched ────────────────────────────────────────
  console.log("\n── tasks occurrence key untouched ──");
  check("tasks permanent partial unique still present", (await scalar(c, `select count(*)::int from pg_indexes where indexname='tasks_recurrence_occurrence_idx' and indexdef ilike '%where (recurrence_definition_id is not null)%'`)) === 1);
  check("tasks column count unchanged (28)", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='tasks'`)) === 28);

  // ── Idempotent re-apply ───────────────────────────────────────────────────
  console.log("\n── re-apply is a no-op ──");
  const reErr = (await tryQuery(c, sqlFile("0052_recurring_definitions_anchor_day.sql"))).error;
  check("re-applying 0052 does not error", reErr === null, reErr?.message ?? "");
  check("still exactly one range CHECK after re-apply", (await scalar(c, `select count(*)::int from pg_constraint where conname='recurring_definitions_anchor_day_range'`)) === 1);

  // ── Full chain composition ────────────────────────────────────────────────
  console.log("\n── full 0036–0052 chain ──");
  let chainErr = null;
  try {
    await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
    await c.query(SCAFFOLD);
    for (const f of CHAIN) await c.query(sqlFile(f));
  } catch (e) { chainErr = e; }
  check("full 0036–0052 chain applies without collision", chainErr === null, chainErr?.message ?? "");

  console.log(`\n${fail === 0 ? "✅" : "❌"} 0052 ANCHOR_DAY CHECKS: ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
