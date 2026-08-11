/**
 * Bbettr OS — Migration 0051 (weekly_updates) proof.
 *
 * Runs the REAL 0051_weekly_updates.sql on top of the 0036 workspace foundation
 * against a disposable local PostgreSQL and verifies the manual Weekly Updates
 * table + its author-scoped, workspace-scoped RLS:
 *   - structure: table, RLS enabled+forced, select/insert/delete policies, NO
 *     update policy, summary CHECK, index, client_id FK (nullable)
 *   - SELECT: an admin sees every update in THEIR workspace (incl. peers'); no
 *     cross-workspace read; clients/reps/anon see zero
 *   - INSERT: admin, own workspace, author=self succeeds; cross-workspace insert,
 *     author-spoof insert, and non-admin insert are all rejected
 *   - DELETE: the author deletes their own; a peer admin canNOT delete it
 *   - summary trimmed length 1..500 enforced; client_id null accepted; UPDATE denied
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const WS1 = "00000000-0000-0000-0000-000000000001"; // agency workspace (0036 seed)
const WS2 = "00000000-0000-0000-0000-000000000002"; // second workspace (test-only)
const C1 = "00000000-0000-0000-0000-0000000000b1"; // a client
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1", // WS1
  admin2: "00000000-0000-0000-0000-0000000000a2", // WS1 (peer)
  admin3: "00000000-0000-0000-0000-0000000000a3", // WS2
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0051: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0051: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
grant usage on schema auth, public to anon, authenticated, service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then
  create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.clients (id uuid primary key default gen_random_uuid());
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text, email text, created_at timestamptz not null default now());
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
grant select on public.profiles to authenticated;
insert into public.clients (id) values ('${C1}');
insert into auth.users (id,email) values
  ('${U.admin1}','a1'),('${U.admin2}','a2'),('${U.admin3}','a3'),('${U.client}','c1'),('${U.rep}','d1');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.admin2}','admin','Ashwin'),('${U.admin3}','admin','WS2 Admin'),
  ('${U.client}','client','Client'),('${U.rep}','rep','Rep');
`;

const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
}
async function scalar(c, text, params = []) {
  const { rows } = await c.query(text, params);
  return rows[0] ? Object.values(rows[0])[0] : undefined;
}
async function runAs(c, role, uid, sql, params = []) {
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]);
    const res = await c.query(sql, params);
    await c.query("rollback");
    return { rows: res.rows, rowCount: res.rowCount ?? 0, error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
/** Build a parameterized insert; the caller supplies the summary as $1. */
const insSql = (ws, author, client = null, date = "2026-08-11") =>
  `insert into public.weekly_updates (workspace_id, author_user_id, summary, client_id, update_date)
   values ('${ws}','${author}',$1,${client ? `'${client}'` : "null"},'${date}')`;

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(sqlFile("0036_planner_workspaces.sql")); // workspaces + seed + current_workspace_id + profiles.workspace_id + admin backfill→WS1
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.admin3}'`);
  await c.query(sqlFile("0051_weekly_updates.sql"));
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Structure ────────────────────────────────────────────────────────────────
  console.log("\n── Structure ──");
  check("weekly_updates table exists", (await scalar(c, `select count(*)::int from information_schema.tables where table_schema='public' and table_name='weekly_updates'`)) === 1);
  check("RLS enabled + forced", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.weekly_updates'::regclass`)) === true);
  check("select/insert/delete policies present; NO update policy",
    (await scalar(c, `select string_agg(cmd,',' order by cmd) from pg_policies where schemaname='public' and tablename='weekly_updates'`)) === "DELETE,INSERT,SELECT");
  check("summary CHECK present", (await scalar(c, `select count(*)::int from pg_constraint where conname='weekly_updates_summary_len'`)) === 1);
  check("(workspace_id, update_date) index present", (await scalar(c, `select count(*)::int from pg_indexes where indexname='weekly_updates_workspace_date_idx'`)) === 1);
  check("client_id is nullable", (await scalar(c, `select is_nullable from information_schema.columns where table_name='weekly_updates' and column_name='client_id'`)) === "YES");

  // ── Constraints (as superuser: triggers/CHECKs still run) ────────────────────
  console.log("\n── Constraints ──");
  check("empty/whitespace summary rejected",
    (await c.query(insSql(WS1, U.admin1), ["   "]).then(() => null).catch((e) => e)) !== null);
  check("summary > 500 chars rejected",
    (await c.query(insSql(WS1, U.admin1), ["x".repeat(501)]).then(() => null).catch((e) => e)) !== null);
  check("client_id null accepted",
    (await c.query(insSql(WS1, U.admin1, null), ["ok"]).then(() => true).catch(() => false)) === true);

  // Clean slate (the "null accepted" check above committed a row), then seed two
  // committed rows (superuser bypasses RLS): admin1's + admin2's, both WS1.
  await c.query(`delete from public.weekly_updates`);
  const u1 = await scalar(c, insSql(WS1, U.admin1, C1) + " returning id", ["Velmore homepage"]);
  const u2 = await scalar(c, insSql(WS1, U.admin2, null) + " returning id", ["MacBuild ads"]);

  // ── SELECT (admin + workspace; peers visible; cross-workspace blind) ─────────
  console.log("\n── SELECT ──");
  check("admin1 sees WS1 updates (own + peer admin2's)",
    (await runAs(c, "authenticated", U.admin1, `select count(*)::int as n from public.weekly_updates`)).rows[0].n === 2);
  check("admin2 (same workspace) also sees admin1's update (transparency)",
    (await runAs(c, "authenticated", U.admin2, `select 1 from public.weekly_updates where id='${u1}'`)).rowCount === 1);
  check("admin3 (WS2) sees ZERO WS1 updates (workspace scoping)",
    (await runAs(c, "authenticated", U.admin3, `select * from public.weekly_updates`)).rowCount === 0);
  check("client sees ZERO", (await runAs(c, "authenticated", U.client, `select * from public.weekly_updates`)).rowCount === 0);
  check("rep sees ZERO", (await runAs(c, "authenticated", U.rep, `select * from public.weekly_updates`)).rowCount === 0);
  {
    const r = await runAs(c, "anon", null, `select * from public.weekly_updates`);
    check("anon denied (error or zero rows)", r.error !== null || r.rowCount === 0);
  }

  // ── INSERT (admin + own workspace + author = self) ──────────────────────────
  console.log("\n── INSERT ──");
  check("admin1 inserts own update (author=self, ws=current) → allowed",
    (await runAs(c, "authenticated", U.admin1, insSql(WS1, U.admin1), ["note"])).rowCount === 1);
  check("admin1 inserting with author=admin2 (spoof) → REJECTED",
    (await runAs(c, "authenticated", U.admin1, insSql(WS1, U.admin2), ["spoof"])).error !== null);
  check("admin1 inserting into WS2 (cross-workspace) → REJECTED",
    (await runAs(c, "authenticated", U.admin1, insSql(WS2, U.admin1), ["xws"])).error !== null);
  check("client inserting → REJECTED",
    (await runAs(c, "authenticated", U.client, insSql(WS1, U.client), ["c"])).error !== null);
  check("rep inserting → REJECTED",
    (await runAs(c, "authenticated", U.rep, insSql(WS1, U.rep), ["r"])).error !== null);

  // ── DELETE (author-only) ─────────────────────────────────────────────────────
  console.log("\n── DELETE ──");
  check("author (admin1) can delete their OWN update",
    (await runAs(c, "authenticated", U.admin1, `delete from public.weekly_updates where id='${u1}'`)).rowCount === 1);
  check("peer admin2 canNOT delete admin1's update (author-only → 0 rows)",
    (await runAs(c, "authenticated", U.admin2, `delete from public.weekly_updates where id='${u1}'`)).rowCount === 0);
  check("admin3 (other workspace) canNOT delete a WS1 update",
    (await runAs(c, "authenticated", U.admin3, `delete from public.weekly_updates where id='${u1}'`)).rowCount === 0);

  // ── UPDATE denied (no policy) ────────────────────────────────────────────────
  console.log("\n── UPDATE ──");
  check("no UPDATE policy → an admin's update of their own row affects 0 rows",
    (await runAs(c, "authenticated", U.admin2, `update public.weekly_updates set summary='edited' where id='${u2}'`)).rowCount === 0);

  console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
