/**
 * Bbettr OS — P2-E prospect-intake CLEANUP proof (behaviour, NO migration).
 *
 * Applies the REAL 0058 schema on a disposable local PostgreSQL, seeds a mix of
 * rows, then runs the EXACT cleanup predicate used by the service-role store —
 *   DELETE FROM prospect_intakes WHERE status='draft' AND token_expires_at < now()
 * — and proves:
 *   - ONLY expired drafts are deleted;
 *   - non-expired drafts and every submitted/converted/dismissed row (even when
 *     expired) are preserved;
 *   - a second run deletes nothing (idempotent).
 * There is NO 0060 migration — this proves the cleanup query against the shipped
 * schema, so it is named for the feature, not a migration number.
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("cleanup: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("cleanup: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text);
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid
  language sql security definer set search_path=public stable as $fn$
  select client_id from profiles where id = auth.uid(); $fn$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $fn$
  begin new.updated_at = now(); return new; end; $fn$;
`;

// Eligibility predicate under test — the EXACT store predicate.
const CLEANUP = `delete from public.prospect_intakes where status='draft' and token_expires_at < now() returning id`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, sql, params = []) { const { rows } = await c.query(sql, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }

const T = "public.prospect_intakes";
const hash = (ch) => ch.repeat(64);
const PAST = "2000-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

// (token_hash, status, expiry) — one of each relevant combination.
const SEED = [
  { h: hash("a"), status: "draft", exp: PAST, label: "expired-draft" },
  { h: hash("b"), status: "draft", exp: FUTURE, label: "live-draft" },
  { h: hash("c"), status: "submitted", exp: PAST, label: "expired-submitted" },
  { h: hash("d"), status: "converted", exp: PAST, label: "expired-converted" },
  { h: hash("e"), status: "dismissed", exp: PAST, label: "expired-dismissed" },
];

async function seed(c) {
  for (const r of SEED) {
    await c.query(
      `insert into ${T} (token_hash, token_expires_at, source, status, submitted_at)
       values ($1, $2, 'generic', $3, $4)`,
      [r.h, r.exp, r.status, r.status === "submitted" ? new Date().toISOString() : null]
    );
  }
}
const exists = (c, h) => scalar(c, `select exists(select 1 from ${T} where token_hash=$1)`, [h]);

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0058_prospect_intakes.sql"), "utf8"));

  console.log("── seed ──");
  await seed(c);
  check("5 rows seeded", (await scalar(c, `select count(*)::int from ${T}`)) === 5);

  console.log("\n── first cleanup run ──");
  const first = await c.query(CLEANUP);
  check("exactly ONE row deleted", first.rowCount === 1);
  check("the deleted row was the expired DRAFT", (await exists(c, hash("a"))) === false);

  console.log("\n── preservation (nothing else touched) ──");
  check("non-expired draft preserved", (await exists(c, hash("b"))) === true);
  check("expired SUBMITTED preserved", (await exists(c, hash("c"))) === true);
  check("expired CONVERTED preserved", (await exists(c, hash("d"))) === true);
  check("expired DISMISSED preserved", (await exists(c, hash("e"))) === true);
  check("4 rows remain", (await scalar(c, `select count(*)::int from ${T}`)) === 4);
  check("no submitted/converted/dismissed/live-draft was deleted",
    (await scalar(c, `select count(*)::int from ${T} where status in ('submitted','converted','dismissed') or (status='draft' and token_expires_at >= now())`)) === 4);

  console.log("\n── idempotency ──");
  const second = await c.query(CLEANUP);
  check("second run deletes ZERO (idempotent)", second.rowCount === 0);
  check("still 4 rows after re-run", (await scalar(c, `select count(*)::int from ${T}`)) === 4);

  console.log(`\n${fail === 0 ? "✅" : "❌"} PROSPECT-INTAKE-CLEANUP CHECKS: ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
