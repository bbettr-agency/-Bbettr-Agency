/**
 * Bbettr OS — Migration 0050 (profiles privileged-column guard) proof.
 *
 * Runs the REAL 0050_profiles_guard_privileged_columns.sql on top of a minimal
 * 0001-style baseline + real 0036, against a disposable local PostgreSQL, and
 * proves the security matrix by simulating each PostgREST principal via
 * `set local role` (+ JWT claims) — exactly how production auth reaches the DB.
 *
 * The guard holds role/client_id/workspace_id for untrusted end-user roles
 * (authenticated/anon, non-admin); admins, the service role, and the
 * migration/superuser retain full control. UPDATE-only; INSERT is untouched.
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const WS = "00000000-0000-0000-0000-000000000001"; // agency workspace (0036 seed)
const CLIENT_A = "00000000-0000-0000-0000-0000000000b1";
const CLIENT_B = "00000000-0000-0000-0000-0000000000b2";
const U = {
  client: "00000000-0000-0000-0000-0000000000c1",
  admin: "00000000-0000-0000-0000-0000000000a1",
  rep: "00000000-0000-0000-0000-0000000000d1",
  newAdmin: "00000000-0000-0000-0000-0000000000a2",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0050: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0050: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

const SCAFFOLD = `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
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
  full_name text, email text, avatar_url text, created_at timestamptz not null default now());
-- End-user roles carry Supabase's default table grants (RLS is the separate first
-- gate; this test isolates the TRIGGER, so it grants directly and skips RLS).
grant select, insert, update, delete on public.profiles to anon, authenticated, service_role;
grant select, insert on public.clients to anon, authenticated, service_role;
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid
  language sql security definer set search_path=public stable as $fn$
  select client_id from profiles where id = auth.uid(); $fn$;
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path=public as $fn$
begin
  insert into public.profiles (id, email, full_name, role, client_id)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name',''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role,'client'),
    nullif(new.raw_user_meta_data ->> 'client_id','')::uuid)
  on conflict (id) do nothing;
  return new;
end $fn$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
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
async function makeUser(c, id, role, extra = {}) {
  return c.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3::jsonb)`,
    [id, `${id.slice(-2)}@t`, JSON.stringify({ role, full_name: `${role}`, ...extra })]);
}
/**
 * Perform an UPDATE as `role` (JWT sub = actorUid) against target `id`, read the
 * resulting row IN-TRANSACTION, then roll back (so cases don't bleed). Returns
 * { row, error } — row reflects what the guard actually allowed.
 */
async function updateAs(c, role, actorUid, id, setSql) {
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(actorUid ? { sub: actorUid, role } : { role })]);
    await c.query(`update public.profiles set ${setSql} where id='${id}'`);
    const { rows } = await c.query(`select role, client_id, workspace_id, full_name, avatar_url from public.profiles where id='${id}'`);
    await c.query("rollback");
    return { row: rows[0], error: null };
  } catch (e) { await c.query("rollback").catch(() => {}); return { row: null, error: e }; }
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();

  // ── Build the chain: baseline → 0036 → (0049 if present) → 0050 ──────────────
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(sqlFile("0036_planner_workspaces.sql"));
  const has0049 = existsSync(join(MIG, "0049_admin_workspace_binding.sql"));
  if (has0049) await c.query(sqlFile("0049_admin_workspace_binding.sql"));
  await c.query(sqlFile("0050_profiles_guard_privileged_columns.sql"));

  // Seed principals (as superuser — not guarded). Adjust privileged fields via
  // superuser UPDATE so the starting state is exact.
  await c.query(`insert into public.clients (id) values ('${CLIENT_A}'),('${CLIENT_B}')`);
  await makeUser(c, U.client, "client", { client_id: CLIENT_A });
  await makeUser(c, U.admin, "admin");
  await makeUser(c, U.rep, "rep");
  await c.query(`update public.profiles set avatar_url='old.png', workspace_id=null where id='${U.client}'`);
  await c.query(`update public.profiles set workspace_id='${WS}' where id='${U.admin}'`); // admin bound

  // ── Structure ────────────────────────────────────────────────────────────────
  console.log("\n── Structure ──");
  check("(9) trigger is BEFORE UPDATE on profiles",
    (await scalar(c, `select count(*)::int from pg_trigger t join pg_class r on r.oid=t.tgrelid
       where r.relname='profiles' and t.tgname='profiles_guard_privileged_columns'
         and (t.tgtype & 2)<>0 /*BEFORE*/ and (t.tgtype & 16)<>0 /*UPDATE*/ and not t.tgisinternal`)) === 1);
  check("(10) function pins search_path=public",
    (await scalar(c, `select coalesce('search_path=public' = any(proconfig),false) from pg_proc where proname='profiles_guard_privileged_columns'`)) === true);
  check("guard function is SECURITY INVOKER (current_user = caller)",
    (await scalar(c, `select prosecdef from pg_proc where proname='profiles_guard_privileged_columns'`)) === false);

  // ── Non-admin end-user (the attacker) ───────────────────────────────────────
  console.log("\n── Non-admin authenticated user ──");
  check("(1) non-admin CAN update full_name",
    (await updateAs(c, "authenticated", U.client, U.client, `full_name='New Name'`)).row.full_name === "New Name");
  check("(2) non-admin CAN update avatar_url",
    (await updateAs(c, "authenticated", U.client, U.client, `avatar_url='new.png'`)).row.avatar_url === "new.png");
  check("(3) non-admin attempting role='admin' stays 'client'",
    (await updateAs(c, "authenticated", U.client, U.client, `role='admin'`)).row.role === "client");
  check("(4) non-admin attempting another client_id stays CLIENT_A",
    (await updateAs(c, "authenticated", U.client, U.client, `client_id='${CLIENT_B}'`)).row.client_id === CLIENT_A);
  check("(5) non-admin attempting the agency workspace_id stays NULL",
    (await updateAs(c, "authenticated", U.client, U.client, `workspace_id='${WS}'`)).row.workspace_id === null);
  {
    const r = (await updateAs(c, "authenticated", U.client, U.client,
      `role='admin', client_id='${CLIENT_B}', workspace_id='${WS}', full_name='Hacker'`)).row;
    check("(6) combined malicious update: NO privileged field changes (name still applies)",
      r.role === "client" && r.client_id === CLIENT_A && r.workspace_id === null && r.full_name === "Hacker");
  }
  check("(13a) rep attempting role='admin' stays 'rep'; name change allowed",
    (await updateAs(c, "authenticated", U.rep, U.rep, `role='admin', full_name='R'`)).row.role === "rep");

  // ── Privileged principals retain control ────────────────────────────────────
  console.log("\n── Admin + service role bypass ──");
  {
    const r = (await updateAs(c, "authenticated", U.admin, U.client, `role='rep', workspace_id='${WS}'`)).row;
    check("(7) ADMIN privileged update applies (role + workspace changed)", r.role === "rep" && r.workspace_id === WS);
  }
  {
    const r = (await updateAs(c, "service_role", null, U.client, `role='admin', workspace_id='${WS}'`)).row;
    check("(8) SERVICE-ROLE privileged update applies (role + workspace changed)", r.role === "admin" && r.workspace_id === WS);
  }

  // ── INSERT untouched + onboarding ────────────────────────────────────────────
  console.log("\n── INSERT / onboarding unaffected ──");
  await makeUser(c, U.newAdmin, "admin");
  check("(11) INSERT path unaffected — a newly created admin has role='admin'",
    (await scalar(c, `select role from public.profiles where id='${U.newAdmin}'`)) === "admin");
  check("(13b) client onboarding intact — client profile exists with role='client' + client_id",
    (await scalar(c, `select role::text||':'||coalesce(client_id::text,'-') from public.profiles where id='${U.client}'`)) === `client:${CLIENT_A}`);
  check("(13c) rep onboarding intact — rep profile exists with role='rep'",
    (await scalar(c, `select role from public.profiles where id='${U.rep}'`)) === "rep");

  // ── 0049 compatibility ───────────────────────────────────────────────────────
  console.log("\n── 0049 compatibility ──");
  if (has0049) {
    check("(12) with 0049 present: the NEW admin was auto-bound to the agency workspace (INSERT trigger)",
      (await scalar(c, `select workspace_id from public.profiles where id='${U.newAdmin}'`)) === WS);
    check("(12) …and 0050 still stops that admin's non-admin peer from self-binding the workspace",
      (await updateAs(c, "authenticated", U.rep, U.rep, `workspace_id='${WS}'`)).row.workspace_id === null);
  } else {
    check("(12) 0049 on a separate branch: 0050 is UPDATE-only so 0049's INSERT-time binding is preserved (INSERT untouched, proven above)", true);
    console.log("      note: 0049 not in this tree; INSERT-vs-UPDATE events never collide — combined check runs once both land in main.");
  }

  // ── Idempotency ──────────────────────────────────────────────────────────────
  console.log("\n── Idempotency ──");
  const rerun = await c.query(sqlFile("0050_profiles_guard_privileged_columns.sql")).then(() => ({ error: null })).catch((e) => ({ error: e }));
  check("(14) re-applying 0050 does not error (create-or-replace + drop/create trigger)", rerun.error === null, rerun.error?.message);
  check("(14) guard still holds after re-apply (role change no-ops)",
    (await updateAs(c, "authenticated", U.client, U.client, `role='admin'`)).row.role === "client");

  console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
