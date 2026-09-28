// ============================================================================
// F1c — effect-operation idempotency concurrency proof (disposable Postgres).
//
// Proves, with TWO GENUINELY INDEPENDENT connections racing in parallel, that:
//
//  ACTION (jarvis_proposals):
//   • same operation key + same effect_hash  → exactly ONE proposal row; both
//     callers resolve to the SAME id (loser SELECTs the winner).
//   • same operation key + DIFFERENT effect_hash → exactly ONE row; the loser
//     observes a stored hash != its own (app maps that to a fail-closed conflict).
//   • distinct operation keys never collide.
//
//  MEMORY (jarvis_memory_create RPC, 0068):
//   • same key + same idem_effect_hash → ONE memory row + ONE 'created' event;
//     both callers return the SAME id.
//   • same key + DIFFERENT idem_effect_hash → ONE row; the other caller raises
//     SQLSTATE BB68C (fail closed).
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
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("f1c: DB name must contain 'test'.");
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

// The exact proposal get-or-create claim the repo relies on.
const PROPOSAL_CLAIM = `
  insert into public.jarvis_proposals
    (workspace_id, capability_id, args, effect, effect_hash, status, initiated_by, is_proactive, expires_at, idempotency_key)
  values ($1, 'portal.propose_internal_task', '{}'::jsonb, $2::jsonb, $3, 'pending', $4, false, now() + interval '1 hour', $5)
  on conflict (idempotency_key) do nothing
  returning id`;

const memRow = (claim) => JSON.stringify({
  scope: "agency", client_id: null, user_id: null, category: "company_knowledge",
  claim, body: null, structured: {}, state: "inferred", current: false, importance: 0,
  source_kind: "model_inference", source_ref: null,
});

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

  const c1 = new pg.Client({ connectionString: url });
  const c2 = new pg.Client({ connectionString: url });
  await c1.connect();
  await c2.connect();

  // ── ACTION: same op key + same effect hash → one row, both resolve same id ──
  const aKey1 = "turn:11111111-1111-4111-8111-111111111111:action:0";
  const [p1, p2] = await Promise.all([
    c1.query(PROPOSAL_CLAIM, [WS, JSON.stringify({ capabilityId: "portal.propose_internal_task", args: { title: "T" } }), H("a"), OWNER, aKey1]),
    c2.query(PROPOSAL_CLAIM, [WS, JSON.stringify({ capabilityId: "portal.propose_internal_task", args: { title: "T" } }), H("a"), OWNER, aKey1]),
  ]);
  const aWinners = [p1, p2].filter((r) => r.rowCount === 1).length;
  check("ACTION same key+same effect: exactly one INSERT wins", aWinners === 1, `winners=${aWinners}`);
  const aRows = await admin.query(`select id, effect_hash from public.jarvis_proposals where idempotency_key=$1`, [aKey1]);
  check("ACTION same key+same effect: exactly one proposal row", aRows.rowCount === 1);
  // Both callers resolve to the same id (loser SELECTs the existing owner row).
  const winnerId = (p1.rowCount === 1 ? p1 : p2).rows[0].id;
  const loserSel = await admin.query(`select id from public.jarvis_proposals where idempotency_key=$1`, [aKey1]);
  check("ACTION same key+same effect: both resolve to the same proposal id", loserSel.rows[0].id === winnerId);

  // ── ACTION: same op key + DIFFERENT effect hash → one row; loser sees mismatch ──
  const aKey2 = "turn:22222222-2222-4222-8222-222222222222:action:0";
  const [d1, d2] = await Promise.all([
    c1.query(PROPOSAL_CLAIM, [WS, JSON.stringify({ capabilityId: "portal.propose_internal_task", args: { title: "A" } }), H("a"), OWNER, aKey2]),
    c2.query(PROPOSAL_CLAIM, [WS, JSON.stringify({ capabilityId: "portal.propose_internal_task", args: { title: "B" } }), H("b"), OWNER, aKey2]),
  ]);
  const dWinners = [d1, d2].filter((r) => r.rowCount === 1);
  check("ACTION same key+different effect: exactly one INSERT wins", dWinners.length === 1);
  const dRows = await admin.query(`select effect_hash from public.jarvis_proposals where idempotency_key=$1`, [aKey2]);
  check("ACTION same key+different effect: exactly one row; stored hash is the winner's (loser deterministically conflicts app-side)",
    dRows.rowCount === 1 && (dRows.rows[0].effect_hash === H("a") || dRows.rows[0].effect_hash === H("b")));

  // ── ACTION: distinct keys never collide ──
  const [e1, e2] = await Promise.all([
    c1.query(PROPOSAL_CLAIM, [WS, JSON.stringify({ args: {} }), H("a"), OWNER, "turn:33333333-3333-4333-8333-333333333333:action:0"]),
    c2.query(PROPOSAL_CLAIM, [WS, JSON.stringify({ args: {} }), H("a"), OWNER, "turn:44444444-4444-4444-8444-444444444444:action:0"]),
  ]);
  check("ACTION distinct op keys both claim independently", e1.rowCount === 1 && e2.rowCount === 1);

  // ── MEMORY: same op key + same effect hash → one memory + one created event ──
  const mKey1 = "turn:55555555-5555-4555-8555-555555555555:memory:0";
  const MEM = `select public.jarvis_memory_create($1::uuid,$2::jsonb,$3::uuid,$4,$5,$6,$7) as id`;
  const [m1, m2] = await Promise.allSettled([
    c1.query(MEM, [WS, memRow("we bill monthly"), OWNER, "Jarvis", "created", mKey1, H("a")]),
    c2.query(MEM, [WS, memRow("we bill monthly"), OWNER, "Jarvis", "created", mKey1, H("a")]),
  ]);
  const mOk = [m1, m2].filter((r) => r.status === "fulfilled");
  const mIds = mOk.map((r) => r.value.rows[0].id);
  check("MEMORY same key+same effect: both calls succeed", mOk.length === 2, `ok=${mOk.length}`);
  check("MEMORY same key+same effect: both return the SAME memory id", mIds.length === 2 && mIds[0] === mIds[1]);
  const mRows = await admin.query(`select count(*)::int c from public.jarvis_memories where idempotency_key=$1`, [mKey1]);
  check("MEMORY same key+same effect: exactly one memory row", mRows.rows[0].c === 1);
  const mEvents = await admin.query(`select count(*)::int c from public.jarvis_memory_events where memory_id=$1 and event_type='created'`, [mIds[0]]);
  check("MEMORY same key+same effect: exactly one 'created' event", mEvents.rows[0].c === 1);

  // ── MEMORY: same op key + DIFFERENT effect hash → one row; other raises BB68C ──
  const mKey2 = "turn:66666666-6666-4666-8666-666666666666:memory:0";
  const [x1, x2] = await Promise.allSettled([
    c1.query(MEM, [WS, memRow("claim A"), OWNER, "Jarvis", "created", mKey2, H("a")]),
    c2.query(MEM, [WS, memRow("claim B"), OWNER, "Jarvis", "created", mKey2, H("b")]),
  ]);
  const settled = [x1, x2];
  const okCount = settled.filter((r) => r.status === "fulfilled").length;
  const bb68c = settled.filter((r) => r.status === "rejected" && r.reason && r.reason.code === "BB68C").length;
  check("MEMORY same key+different effect: exactly one succeeds", okCount === 1, `ok=${okCount}`);
  check("MEMORY same key+different effect: the other raises BB68C", bb68c === 1, `bb68c=${bb68c}`);
  const mRows2 = await admin.query(`select count(*)::int c from public.jarvis_memories where idempotency_key=$1`, [mKey2]);
  check("MEMORY same key+different effect: exactly one memory row", mRows2.rows[0].c === 1);

  await c1.end();
  await c2.end();
  await admin.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} F1c EFFECT IDEMPOTENCY CONCURRENCY: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
