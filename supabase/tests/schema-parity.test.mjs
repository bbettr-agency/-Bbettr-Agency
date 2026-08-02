/**
 * schema-parity.test.mjs — permanent CI schema-parity gate for the Tasks domain.
 *
 * Proves the two supported migration orderings converge to a BYTE-IDENTICAL
 * final schema (persistence-architecture.md §20, schema-and-migration-spec.md §2):
 *
 *   Path A (clean/test):   scaffold → 0027 (legacy tasks + enums)
 *                                   → 0035 (supersede: drops empty legacy)
 *                                   → 0036…0047
 *   Path B (prod-equiv):   scaffold → 0035 (no legacy → drops are no-ops)
 *                                   → 0036…0047
 *
 * 0001–0034 are identical files on BOTH sides and touch no Tasks object except
 * 0027, so the ONLY divergence point is 0027 vs its supersession — which this
 * test isolates on a shared minimal scaffold (profiles/clients/auth.uid/is_admin,
 * exactly what the migrations reference). A zero diff here is the convergence
 * proof the closeout requires; any residue from legacy 0027 surfaces as a DIFF.
 *
 * Compared object classes (normalized, order-independent): columns (name/type/
 * nullability/default), constraints (pg_get_constraintdef), indexes (indexdef),
 * functions (identity args + secdef + volatility + config + return + FULL body),
 * triggers (pg_get_triggerdef), policies (name/cmd/qual/withcheck), RLS
 * enable+force flags, grants (role×object×privilege), sequences, and enum types.
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

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("schema-parity: DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("schema-parity: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

// Minimal shared baseline: exactly the pre-existing objects the Tasks migrations
// reference (profiles, clients, auth.uid(), is_admin(), the three Supabase roles).
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
`;

const NEW = [
  "0036_planner_workspaces.sql", "0037_planner_tasks_core.sql", "0038_planner_task_blockers.sql",
  "0039_planner_task_dependencies.sql", "0040_planner_labels.sql", "0041_planner_recurring_definitions.sql",
  "0042_planner_task_reminders.sql", "0043_planner_task_events.sql", "0044_planner_event_redactions.sql",
  "0045_planner_command_receipts.sql", "0046_planner_internal_persistence.sql", "0047_planner_safe_read_models.sql",
];

async function build(c, withLegacy) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  if (withLegacy) await c.query(sqlFile("0027_planner_tasks.sql"));
  await c.query(sqlFile("0035_planner_tasks_supersede_legacy.sql"));
  for (const f of NEW) await c.query(sqlFile(f));
}

async function signature(c) {
  const q = async (s) => (await c.query(s)).rows.map((r) => r.sig);
  return {
    columns: await q(`select (table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'')) sig
      from information_schema.columns where table_schema='public' order by 1`),
    constraints: await q(`select (conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid)) sig
      from pg_constraint where connamespace='public'::regnamespace order by 1`),
    indexes: await q(`select (indexname||'|'||indexdef) sig from pg_indexes where schemaname='public' order by 1`),
    functions: await q(`select (p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|secdef='||p.prosecdef::text
      ||'|vol='||p.provolatile::text||'|cfg='||coalesce(array_to_string(p.proconfig,','),'')
      ||'|ret='||pg_get_function_result(p.oid)||'|body='||md5(pg_get_functiondef(p.oid))) sig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`),
    triggers: await q(`select (tgrelid::regclass::text||'|'||pg_get_triggerdef(oid)) sig from pg_trigger
      where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace) order by 1`),
    policies: await q(`select (polrelid::regclass::text||'|'||polname||'|'||polcmd::text
      ||'|'||coalesce(pg_get_expr(polqual,polrelid),'')||'|'||coalesce(pg_get_expr(polwithcheck,polrelid),'')) sig
      from pg_policy where polrelid in (select oid from pg_class where relnamespace='public'::regnamespace) order by 1`),
    rls: await q(`select (relname||'|force='||relforcerowsecurity::text||'|enable='||relrowsecurity::text) sig
      from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1`),
    grants: await q(`select (table_name||'|'||grantee||'|'||privilege_type) sig from information_schema.role_table_grants
      where table_schema='public' and grantee in ('anon','authenticated','service_role') order by 1`),
    sequences: await q(`select (sequencename||'|'||data_type||'|start='||start_value||'|inc='||increment_by||'|min='||min_value||'|max='||max_value) sig
      from pg_sequences where schemaname='public' order by 1`),
    enums: await q(`select (t.typname||'|'||string_agg(e.enumlabel,',' order by e.enumsortorder)) sig
      from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname order by 1`),
  };
}

let fail = 0;
function diff(a, b, label) {
  const A = new Set(a), B = new Set(b);
  const onlyA = [...A].filter((x) => !B.has(x)), onlyB = [...B].filter((x) => !A.has(x));
  if (onlyA.length || onlyB.length) {
    console.log(`FAIL  ${label}: pathA-only=${onlyA.length} pathB-only=${onlyB.length}`);
    onlyA.slice(0, 8).forEach((x) => console.log(`   A-only: ${x}`));
    onlyB.slice(0, 8).forEach((x) => console.log(`   B-only: ${x}`));
    fail++;
  } else {
    console.log(`PASS  ${label}: identical (${a.length})`);
  }
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();

  await build(c, false); const B = await signature(c); // prod-equivalent
  await build(c, true);  const A = await signature(c); // clean/test (with legacy 0027)

  console.log("── Schema parity: Path A (0027 + supersede) vs Path B (no 0027) ──");
  for (const k of ["columns", "constraints", "indexes", "functions", "triggers", "policies", "rls", "grants", "sequences", "enums"])
    diff(A[k], B[k], k);

  await c.end();
  console.log(`\n${fail === 0 ? "✅ SCHEMA PARITY: both paths converge to an identical final schema" : "❌ SCHEMA PARITY DIFFERENCES FOUND"}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
