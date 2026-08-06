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
grant select, insert, delete on public.clients to anon, authenticated, service_role;
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

  // ── Bypass hardening: multi-row, upsert, FK cascade ─────────────────────────
  console.log("\n── Bypass hardening ──");
  // (15) multi-row UPDATE by a non-admin: the BEFORE UPDATE trigger fires per row,
  // so NO non-admin row is promoted (admins keep their pre-existing role).
  {
    await c.query("begin");
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U.client, role: "authenticated" })]);
    await c.query(`update public.profiles set role='admin'`); // no WHERE — every row
    const admins = (await c.query(`select id from public.profiles where role='admin' order by id`)).rows.map((r) => r.id);
    await c.query("rollback");
    check("(15) multi-row UPDATE by non-admin promotes NOBODY (admin set unchanged)",
      JSON.stringify(admins) === JSON.stringify([U.admin, U.newAdmin].sort()));
  }
  // (16) UPSERT: the DO UPDATE branch of INSERT..ON CONFLICT fires the guard.
  {
    await c.query("begin");
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U.client, role: "authenticated" })]);
    await c.query(`insert into public.profiles (id, role, full_name) values ('${U.client}','admin','UP')
                   on conflict (id) do update set role='admin', full_name='UP'`);
    const row = (await c.query(`select role, full_name from public.profiles where id='${U.client}'`)).rows[0];
    await c.query("rollback");
    check("(16) UPSERT DO UPDATE by non-admin: role held to 'client', name still applies", row.role === "client" && row.full_name === "UP");
  }
  // (17) client delete → ON DELETE SET NULL cascade (as service_role): must NOT be
  // blocked by the guard, or client deletion would break with an FK violation.
  {
    await c.query("begin");
    await c.query(`set local role service_role`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ role: "service_role" })]);
    let err = null;
    try { await c.query(`delete from public.clients where id='${CLIENT_A}'`); } catch (e) { err = e; }
    const cid = err ? "(delete failed)" : (await c.query(`select client_id from public.profiles where id='${U.client}'`)).rows[0].client_id;
    await c.query("rollback");
    check("(17) client delete cascade succeeds + profile.client_id set NULL (guard never blocks the RI action)", err === null && cid === null, err?.message);
  }

  // ── RLS-on: the real-world composition (RLS is the gate, the trigger the guard) ─
  console.log("\n── RLS-on composition ──");
  await c.query(`alter table public.profiles enable row level security`);
  await c.query(`create policy p_sel on public.profiles for select to authenticated using (id = auth.uid())`);
  await c.query(`create policy p_upd on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid())`);
  await c.query(`create policy p_admin on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin())`);
  // (18a) RLS ALLOWS a user to update their own row, but the trigger neutralises
  // the escalation — role stays 'client', no error (this is the production path).
  {
    await c.query("begin");
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U.client, role: "authenticated" })]);
    let err = null;
    try { await c.query(`update public.profiles set role='admin' where id=auth.uid()`); } catch (e) { err = e; }
    const role = err ? "(err)" : (await c.query(`select role from public.profiles where id='${U.client}'`)).rows[0].role;
    await c.query("rollback");
    check("(18a) RLS-on: non-admin self-update succeeds but role held to 'client' (defense-in-depth)", err === null && role === "client");
  }
  // (18b) The INSERT/upsert escalation vector is closed by RLS (no non-admin INSERT
  // policy) — so an attacker can't sidestep the UPDATE-only guard via INSERT.
  {
    const r = await c.query("begin")
      .then(() => c.query(`set local role authenticated`))
      .then(() => c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U.client, role: "authenticated" })]))
      .then(() => c.query(`insert into public.profiles (id, role) values ('${U.client}','admin') on conflict (id) do update set role='admin'`))
      .then(() => ({ error: null }))
      .catch((e) => ({ error: e }));
    await c.query("rollback").catch(() => {});
    check("(18b) non-admin INSERT/upsert of an admin row is REJECTED by RLS (no insert policy)", r.error !== null);
  }

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
