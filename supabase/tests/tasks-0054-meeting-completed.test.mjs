/**
 * Bbettr OS — Migration 0054 (meeting completion / post-meeting lifecycle) proof.
 *
 * Runs the REAL 0054 on top of the meetings chain (0029–0034) + 0053 against a
 * disposable local PostgreSQL and verifies:
 *   - the THREE additive columns (attended_at, outcome_notes, thank_you_sent_at)
 *     exist with correct type + nullability;
 *   - outcome_notes CHECK: NULL ok, exactly 4000 chars ok, 4001 chars rejected;
 *   - meetings_outcome_exclusive CHECK: attended-only ok, no_show-only ok,
 *     both-NULL ok, both-non-null REJECTED;
 *   - NO status change (status='completed'/'no_show' still rejected; CHECK still
 *     exactly scheduled|cancelled);
 *   - 0054 adds NO new table and NO new index (counts identical pre/post-0054);
 *   - the meetings audit trigger is byte-for-byte UNCHANGED across 0054;
 *   - RLS (enabled+forced, exactly the 3 original policies, no anon grant) is
 *     UNCHANGED across 0054;
 *   - 0053's confirm_meeting_reschedule (existence, SECURITY INVOKER, EXECUTE =
 *     service_role only) is UNCHANGED across 0054;
 *   - the full meetings chain + 0053 + 0054 composes cleanly;
 *   - ZERO BACKFILL: a past scheduled meeting inserted BEFORE 0054 keeps
 *     attended_at NULL afterwards and derives as 'needs_outcome'.
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const CLIENT_ROW = "00000000-0000-0000-0000-0000000000b1";
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1",
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0054: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0054: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
insert into auth.users (id,email) values ('${U.admin1}','a1'),('${U.client}','c1'),('${U.rep}','d1');
insert into public.clients (id) values ('${CLIENT_ROW}');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.client}','client','Client'),('${U.rep}','rep','Rep');
`;

const MEETINGS_CHAIN = [
  "0029_meetings.sql", "0030_meeting_attendees.sql", "0031_calendar_projections.sql",
  "0032_meetings_idempotency.sql", "0033_create_meeting_rpc.sql", "0034_soft_delete_meeting.sql",
];
const MIG_0053 = "0053_meeting_no_show_reschedule.sql";
const MIG_0054 = "0054_meeting_completed_lifecycle.sql";

const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");
let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function tryQuery(c, text, params = []) {
  try { const r = await c.query(text, params); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { return { rows: [], rowCount: 0, error: e }; }
}
async function scalar(c, text, params = []) { const { rows } = await c.query(text, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }

/** Insert a meeting (audit trigger stamps created_by from auth.uid()). Extra cols passed through. */
async function insMeeting(c, over = {}) {
  const base = { title: "M", starts_at: "2026-09-01T09:00:00Z", ends_at: "2026-09-01T10:00:00Z" };
  const merged = { ...base, ...over };
  const keys = Object.keys(merged);
  return tryQuery(c,
    `insert into public.meetings (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((k) => merged[k]));
}
async function meetingRow(c, id) {
  return (await c.query(`select * from public.meetings where id=$1`, [id])).rows[0];
}

// ── Snapshots of invariants that 0054 MUST NOT change ────────────────────────
async function snapshot(c) {
  return {
    triggerDef: await scalar(c, `select pg_get_functiondef('public.meetings_enforce_audit()'::regprocedure)`),
    policies: (await c.query(
      `select policyname, cmd, coalesce(qual,'') as qual, coalesce(with_check,'') as wc
       from pg_policies where schemaname='public' and tablename='meetings' order by policyname`)).rows,
    rlsForced: await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.meetings'::regclass`),
    anonGrants: await scalar(c, `select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name='meetings' and grantee='anon'`),
    indexes: (await c.query(`select indexname from pg_indexes where schemaname='public' and tablename='meetings' order by indexname`)).rows.map((r) => r.indexname),
    tables: await scalar(c, `select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`),
    fnSecdef: await scalar(c, `select prosecdef from pg_proc where proname='confirm_meeting_reschedule'`),
    fnSvc: await scalar(c, `select has_function_privilege('service_role','public.confirm_meeting_reschedule(text, timestamptz, timestamptz)','EXECUTE')`),
    fnAnon: await scalar(c, `select has_function_privilege('anon','public.confirm_meeting_reschedule(text, timestamptz, timestamptz)','EXECUTE')`),
    fnAuthd: await scalar(c, `select has_function_privilege('authenticated','public.confirm_meeting_reschedule(text, timestamptz, timestamptz)','EXECUTE')`),
  };
}

async function base(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of MEETINGS_CHAIN) await c.query(sqlFile(f));
  await c.query(sqlFile(MIG_0053));
  // Act as admin so the audit trigger's auth.uid() resolves on inserts.
  await c.query(`select set_config('request.jwt.claims', json_build_object('sub','${U.admin1}')::text, false)`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();

  // Bring the schema to the PRE-0054 state (chain + 0053), snapshot invariants,
  // and insert a historical PAST scheduled meeting BEFORE 0054 exists.
  await base(c);
  const before = await snapshot(c);
  const histId = await scalar(c,
    `insert into public.meetings (title, starts_at, ends_at)
     values ('Historical', now() - interval '2 hours', now() - interval '1 hour') returning id`);

  // Apply the REAL 0054.
  const applied = await tryQuery(c, sqlFile(MIG_0054));
  check("0054 applies cleanly on top of the full meetings chain + 0053", applied.error === null, applied.error?.message);

  const after = await snapshot(c);

  // ── Added columns ──────────────────────────────────────────────────────────
  console.log("\n── added columns ──");
  const cols = (await c.query(
    `select column_name, data_type, is_nullable from information_schema.columns
     where table_schema='public' and table_name='meetings' and column_name = any($1)`,
    [["attended_at", "outcome_notes", "thank_you_sent_at"]])).rows;
  const byName = Object.fromEntries(cols.map((r) => [r.column_name, r]));
  check("attended_at: timestamptz, nullable", byName.attended_at?.data_type === "timestamp with time zone" && byName.attended_at?.is_nullable === "YES");
  check("outcome_notes: text, nullable", byName.outcome_notes?.data_type === "text" && byName.outcome_notes?.is_nullable === "YES");
  check("thank_you_sent_at: timestamptz, nullable", byName.thank_you_sent_at?.data_type === "timestamp with time zone" && byName.thank_you_sent_at?.is_nullable === "YES");

  // ── outcome_notes length CHECK ───────────────────────────────────────────────
  console.log("\n── outcome_notes 4000-char CHECK ──");
  check("NULL notes accepted", (await insMeeting(c, { outcome_notes: null })).error === null);
  check("exactly 4000 chars accepted", (await insMeeting(c, { outcome_notes: "a".repeat(4000) })).error === null);
  check("4001 chars rejected", (await insMeeting(c, { outcome_notes: "a".repeat(4001) })).error !== null);
  const notesDef = await scalar(c, `select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.meetings'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%char_length(outcome_notes)%'`);
  check("outcome_notes CHECK is <= 4000", /<=\s*4000/.test(notesDef ?? ""), notesDef ?? "not found");

  // ── mutual-exclusion CHECK ───────────────────────────────────────────────────
  console.log("\n── meetings_outcome_exclusive CHECK ──");
  const nowIso = new Date().toISOString();
  check("constraint meetings_outcome_exclusive exists", (await scalar(c,
    `select count(*)::int from pg_constraint where conrelid='public.meetings'::regclass and conname='meetings_outcome_exclusive'`)) === 1);
  check("attended_at only accepted", (await insMeeting(c, { attended_at: nowIso })).error === null);
  check("no_show_at only accepted", (await insMeeting(c, { no_show_at: nowIso })).error === null);
  check("both NULL accepted", (await insMeeting(c, { attended_at: null, no_show_at: null })).error === null);
  check("attended_at + no_show_at both non-null REJECTED", (await insMeeting(c, { attended_at: nowIso, no_show_at: nowIso })).error !== null);

  // ── status vocabulary unchanged (no new status value) ────────────────────────
  console.log("\n── status vocabulary unchanged ──");
  check("status='completed' rejected (no new status)", (await insMeeting(c, { status: "completed" })).error !== null);
  check("status='no_show' rejected (no new status)", (await insMeeting(c, { status: "no_show" })).error !== null);
  check("status='scheduled' accepted", (await insMeeting(c, { status: "scheduled" })).error === null);
  const statusDef = await scalar(c, `select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.meetings'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%status = any%'`);
  check("status CHECK still exactly scheduled|cancelled", /'scheduled'::text/.test(statusDef ?? "") && /'cancelled'::text/.test(statusDef ?? "") && !/completed|no_show/.test(statusDef ?? ""), statusDef ?? "not found");

  // ── no new table / no new index across 0054 ──────────────────────────────────
  console.log("\n── no new table / index ──");
  check("public base-table count unchanged across 0054", before.tables === after.tables, `${before.tables} -> ${after.tables}`);
  check("meetings index set unchanged across 0054", JSON.stringify(before.indexes) === JSON.stringify(after.indexes), `${before.indexes} -> ${after.indexes}`);

  // ── audit trigger unchanged ──────────────────────────────────────────────────
  console.log("\n── meetings audit trigger unchanged ──");
  check("meetings_enforce_audit definition byte-for-byte unchanged", before.triggerDef === after.triggerDef);
  check("trigger still attached (before insert or update)", (await scalar(c,
    `select count(*)::int from pg_trigger where tgrelid='public.meetings'::regclass and tgname='meetings_enforce_audit' and not tgisinternal`)) === 1);

  // ── RLS / policies / grants unchanged ────────────────────────────────────────
  console.log("\n── RLS + policies + grants unchanged ──");
  check("RLS still enabled + forced", after.rlsForced === true && before.rlsForced === true);
  check("exactly 3 policies (select/insert/update), unchanged", JSON.stringify(before.policies) === JSON.stringify(after.policies) && after.policies.length === 3, JSON.stringify(after.policies.map((p) => p.policyname)));
  check("no anon grant on meetings (unchanged)", before.anonGrants === 0 && after.anonGrants === 0);

  // ── 0053 function + permissions unchanged ────────────────────────────────────
  console.log("\n── 0053 confirm_meeting_reschedule unchanged ──");
  check("function still exists", (await scalar(c, `select count(*)::int from pg_proc where proname='confirm_meeting_reschedule'`)) === 1);
  check("still SECURITY INVOKER (prosecdef=false)", after.fnSecdef === false && before.fnSecdef === false);
  check("service_role still has EXECUTE", before.fnSvc === true && after.fnSvc === true);
  check("anon still DENIED EXECUTE", before.fnAnon === false && after.fnAnon === false);
  check("authenticated still DENIED EXECUTE", before.fnAuthd === false && after.fnAuthd === false);

  // ── zero backfill: existing rows remain unclassified ─────────────────────────
  console.log("\n── zero backfill / existing rows unclassified ──");
  const hist = await meetingRow(c, histId);
  check("historical row still exists", !!hist);
  check("historical row: attended_at IS NULL (NOT backfilled)", hist.attended_at === null);
  check("historical row: outcome_notes / thank_you_sent_at NULL", hist.outcome_notes === null && hist.thank_you_sent_at === null);
  check("historical row: no_show_at NULL + status scheduled + ends_at in the past → derives Needs outcome",
    hist.no_show_at === null && hist.status === "scheduled" && new Date(hist.ends_at) <= new Date());

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0054 MEETING-COMPLETED CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
