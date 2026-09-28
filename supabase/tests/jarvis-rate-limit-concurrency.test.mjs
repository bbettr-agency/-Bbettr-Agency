// ============================================================================
// F2a — jarvis_rate_check CONCURRENCY proof (disposable Postgres).
//
// Proves, with MANY GENUINELY INDEPENDENT connections racing in parallel, that the
// atomic RPC cannot be oversubscribed — including the release-blocking FRESH-ROW case
// (no counter row exists before the burst). Uses a tiny limit (per_minute = 3) and a
// much larger burst so a weak lock would show as oversubscription.
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
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("f2a: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1";
const U1 = "00000000-0000-0000-0000-0000000000a1";
const U2 = "00000000-0000-0000-0000-0000000000a2";

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
insert into auth.users (id,email) values ('${U1}','a1@t'), ('${U2}','a2@t');
insert into public.profiles (id,role,workspace_id) values ('${U1}','admin','${WS}'), ('${U2}','admin','${WS}');
`;

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d && !ok ? "  — " + d : ""}`); ok ? pass++ : fail++; };

const RPC = `select public.jarvis_rate_check($1,$2,$3,$4,$5) as v`;

async function burst(url, ws, user, n, min, hr, day) {
  // N genuinely independent connections, each issuing ONE concurrent RPC call.
  const clients = Array.from({ length: n }, () => new pg.Client({ connectionString: url }));
  await Promise.all(clients.map((c) => c.connect()));
  try {
    const results = await Promise.all(clients.map((c) => c.query(RPC, [ws, user, min, hr, day]).then((r) => r.rows[0].v)));
    return results;
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}

async function main() {
  assertDisposableTarget();
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/planner_test";
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await admin.query(SCAFFOLD);
  for (const m of ["0062_jarvis_foundation.sql", "0063_jarvis_action_events_fk_carveout.sql", "0064_jarvis_memory.sql", "0065_jarvis_memory_privilege_hardening.sql", "0066_jarvis_foundation_privilege_hardening.sql", "0067_jarvis_conversations.sql", "0068_jarvis_turn_idempotency.sql", "0069_jarvis_rate_limit.sql"]) {
    await admin.query(readFileSync(join(MIG, m), "utf8"));
  }
  const LIMIT = 3, BURST = 20;

  // ── FRESH-ROW RACE: no counter row exists; run it multiple times to expose a weak init lock ──
  let freshOk = true;
  for (let round = 0; round < 4; round++) {
    await admin.query(`delete from public.jarvis_rate_counters where user_id=$1`, [U1]);
    const res = await burst(url, WS, U1, BURST, LIMIT, 120, 600);
    const allowed = res.filter((r) => r.allowed === true).length;
    const denied = res.filter((r) => r.allowed === false).length;
    const stored = (await admin.query(`select minute_count from public.jarvis_rate_counters where user_id=$1`, [U1])).rows[0].minute_count;
    const ok = allowed === LIMIT && denied === BURST - LIMIT && stored === LIMIT;
    if (!ok) { freshOk = false; check(`fresh-row race round ${round}: allowed=${allowed} denied=${denied} stored=${stored}`, false); }
  }
  check(`FRESH-ROW race x4: exactly ${LIMIT} allowed, ${BURST - LIMIT} denied, minute_count=${LIMIT} each round`, freshOk);

  // ── EXISTING-ROW burst: further calls all denied; count stays at the limit ──
  const res2 = await burst(url, WS, U1, BURST, LIMIT, 120, 600);
  check("existing-row burst: 0 allowed (already at limit)", res2.filter((r) => r.allowed === true).length === 0);
  check("minute_count remains exactly LIMIT after denied burst", (await admin.query(`select minute_count from public.jarvis_rate_counters where user_id=$1`, [U1])).rows[0].minute_count === LIMIT);

  // ── two users do NOT share quota under concurrency ──
  await admin.query(`delete from public.jarvis_rate_counters`);
  const [r1, r2] = await Promise.all([burst(url, WS, U1, BURST, LIMIT, 120, 600), burst(url, WS, U2, BURST, LIMIT, 120, 600)]);
  check("U1 gets exactly LIMIT under concurrent two-user load", r1.filter((r) => r.allowed).length === LIMIT);
  check("U2 gets exactly LIMIT under concurrent two-user load", r2.filter((r) => r.allowed).length === LIMIT);
  check("each user has its own counter row = LIMIT", (await admin.query(`select count(*)::int c from public.jarvis_rate_counters where minute_count=${LIMIT}`)).rows[0].c === 2);

  await admin.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} F2a RATE LIMIT CONCURRENCY: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
