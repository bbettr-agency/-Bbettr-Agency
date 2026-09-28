// ============================================================================
// F1b — jarvis_turns CLAIM concurrency proof (disposable Postgres).
//
// The durable turn repository claims via INSERT ... ON CONFLICT
// (workspace_id,user_id,idempotency_key) DO NOTHING RETURNING (supabase-js
// upsert + ignoreDuplicates). This proves the DB unique constraint is the sole
// concurrency arbiter using TWO GENUINELY INDEPENDENT connections in parallel —
// not sequential mocked calls.
//
//   TEST_DATABASE_URL must point at a disposable DB whose name contains "test".
// ============================================================================
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const db = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("f1b: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1";
const OWNER = "00000000-0000-0000-0000-0000000000a1";
const H = (c) => c.repeat(64);

const SCAFFOLD = `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub','')::uuid $fn$;
grant usage on schema auth, public to anon, authenticated, service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.workspaces (id uuid primary key, name text, slug text unique);
create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role public.user_role not null default 'client', client_id uuid references public.clients(id) on delete set null, workspace_id uuid references public.workspaces(id));
create or replace function public.is_admin() returns boolean language sql security definer set search_path=public stable as $fn$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_workspace_id() returns uuid language sql security definer set search_path=public stable as $fn$ select workspace_id from profiles where id = auth.uid(); $fn$;
grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
insert into public.workspaces (id,name,slug) values ('${WS}','Agency','agency');
insert into auth.users (id,email) values ('${OWNER}','o@t');
insert into public.profiles (id,role,workspace_id) values ('${OWNER}','admin','${WS}');
`;

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d && !ok ? "  — " + d : ""}`); ok ? pass++ : fail++; };

// The exact claim statement the repo relies on (supabase upsert+ignoreDuplicates).
const CLAIM_SQL = `
  insert into public.jarvis_turns (workspace_id, user_id, idempotency_key, request_hash, correlation_id, lease_expires_at)
  values ($1,$2,$3,$4,$5, now() + interval '5 min')
  on conflict (workspace_id, user_id, idempotency_key) do nothing
  returning id`;

async function main() {
  assertDisposableTarget();
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/planner_test";
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await admin.query(SCAFFOLD);
  for (const m of ["0062_jarvis_foundation.sql", "0063_jarvis_action_events_fk_carveout.sql", "0064_jarvis_memory.sql", "0065_jarvis_memory_privilege_hardening.sql", "0066_jarvis_foundation_privilege_hardening.sql", "0067_jarvis_conversations.sql", "0068_jarvis_turn_idempotency.sql"]) {
    await admin.query(readFileSync(join(MIG, m), "utf8"));
  }

  // Two independent connections for genuine parallel racing.
  const c1 = new pg.Client({ connectionString: url });
  const c2 = new pg.Client({ connectionString: url });
  await c1.connect();
  await c2.connect();

  // ── same key + same hash: exactly one INSERT wins ──
  const key1 = "11111111-1111-4111-8111-111111111111";
  const [r1, r2] = await Promise.all([
    c1.query(CLAIM_SQL, [WS, OWNER, key1, H("a"), "11111111-1111-1111-1111-111111111111"]),
    c2.query(CLAIM_SQL, [WS, OWNER, key1, H("a"), "22222222-2222-2222-2222-222222222222"]),
  ]);
  const winners = [r1, r2].filter((r) => r.rowCount === 1).length;
  const losers = [r1, r2].filter((r) => r.rowCount === 0).length;
  check("concurrent same key+hash: exactly one INSERT wins", winners === 1 && losers === 1, `winners=${winners} losers=${losers}`);
  check("exactly one turn row exists for the key", (await admin.query(`select count(*)::int c from public.jarvis_turns where idempotency_key=$1`, [key1])).rows[0].c === 1);
  // the loser can read the existing owner row by the full key tuple
  const existing = await admin.query(`select id, request_hash from public.jarvis_turns where workspace_id=$1 and user_id=$2 and idempotency_key=$3`, [WS, OWNER, key1]);
  check("loser can SELECT the existing owner row", existing.rowCount === 1 && existing.rows[0].request_hash === H("a"));

  // ── same key + DIFFERENT hash: still one row; stored hash is the winner's ──
  const key2 = "22222222-2222-4222-8222-222222222222";
  const [d1, d2] = await Promise.all([
    c1.query(CLAIM_SQL, [WS, OWNER, key2, H("a"), "33333333-3333-3333-3333-333333333333"]),
    c2.query(CLAIM_SQL, [WS, OWNER, key2, H("b"), "44444444-4444-4444-4444-444444444444"]),
  ]);
  const dWinners = [d1, d2].filter((r) => r.rowCount === 1);
  check("concurrent same key+DIFFERENT hash: exactly one INSERT wins", dWinners.length === 1);
  const stored = await admin.query(`select request_hash from public.jarvis_turns where workspace_id=$1 and user_id=$2 and idempotency_key=$3`, [WS, OWNER, key2]);
  check("exactly one row; loser observes the winner's hash (app maps mismatch → conflict)", stored.rowCount === 1 && (stored.rows[0].request_hash === H("a") || stored.rows[0].request_hash === H("b")));

  // ── different keys never collide ──
  const [e1, e2] = await Promise.all([
    c1.query(CLAIM_SQL, [WS, OWNER, "33333333-3333-4333-8333-333333333333", H("a"), "55555555-5555-5555-5555-555555555555"]),
    c2.query(CLAIM_SQL, [WS, OWNER, "44444444-4444-4444-8444-444444444444", H("a"), "66666666-6666-6666-6666-666666666666"]),
  ]);
  check("distinct keys both claim independently", e1.rowCount === 1 && e2.rowCount === 1);

  await c1.end();
  await c2.end();
  await admin.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} F1b TURN CLAIM CONCURRENCY: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
