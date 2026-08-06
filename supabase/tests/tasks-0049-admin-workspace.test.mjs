/**
 * Bbettr OS — Migration 0049 (permanent admin → agency-workspace binding) proof.
 *
 * Runs the REAL 0049_admin_workspace_binding.sql on top of a minimal 0001-style
 * profiles baseline + the real 0036 workspace foundation, against a disposable
 * local PostgreSQL. Exercises the FULL production path — insert auth.users with
 * role metadata → handle_new_user() creates the profile → the 0049 BEFORE INSERT
 * trigger binds the workspace — plus the one-time backfill:
 *
 *   - structure: assign_admin_workspace() exists, SECURITY DEFINER; BEFORE INSERT
 *     trigger present on public.profiles
 *   - backfill: an existing admin with a NULL workspace is bound to the agency ws
 *   - non-overwrite: an existing admin already bound to another workspace is kept
 *   - client/rep pre-0049 stay NULL
 *   - NEW admin (via the auth trigger) → auto-bound to the agency workspace
 *   - NEW admin already carrying a workspace → not overwritten
 *   - NEW client / NEW rep → NULL (unchanged)
 *   - FAIL CLOSED: agency workspace absent → new admin gets NULL AND the insert
 *     still succeeds (profile creation is never blocked)
 *   - idempotency: re-running the backfill changes nothing and never errors
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const WS = "00000000-0000-0000-0000-000000000001"; // agency workspace (0036 seed)
const WS2 = "00000000-0000-0000-0000-000000000002"; // a second workspace (test-only)
const U = {
  preAdminNull: "00000000-0000-0000-0000-0000000000a1",
  preAdminBound: "00000000-0000-0000-0000-0000000000a2",
  preClient: "00000000-0000-0000-0000-0000000000c1",
  newAdmin: "00000000-0000-0000-0000-0000000000a3",
  newAdminPreset: "00000000-0000-0000-0000-0000000000a4",
  newClient: "00000000-0000-0000-0000-0000000000c2",
  newRep: "00000000-0000-0000-0000-0000000000d1",
  failClosedAdmin: "00000000-0000-0000-0000-0000000000a9",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0049: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0049: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

// Minimal 0001-style baseline: auth.users (+ metadata), user_role, clients,
// profiles, is_admin(), and the REAL handle_new_user() trigger (role/client_id
// from raw_user_meta_data) so tests drive the true production insert path.
const SCAFFOLD = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub','')::uuid $fn$;
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
-- Real handle_new_user(): role + client_id come from raw_user_meta_data (0001).
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path=public as $fn$
begin
  insert into public.profiles (id, email, full_name, role, client_id)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'client'),
    nullif(new.raw_user_meta_data ->> 'client_id', '')::uuid)
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
/** Create an auth user with role metadata → handle_new_user makes the profile. */
async function makeUser(c, id, role, extra = {}) {
  const meta = JSON.stringify({ role, full_name: `${role} ${id.slice(-2)}`, ...extra });
  return c.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3::jsonb)`, [id, `${id.slice(-2)}@t`, meta]);
}
const wsOf = (c, id) => scalar(c, `select workspace_id from public.profiles where id=$1`, [id]);

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(sqlFile("0036_planner_workspaces.sql")); // workspaces + seed + workspace_id + current_workspace_id
  await c.query(`insert into public.workspaces (id,name,slug) values ('${WS2}','WS Two','ws-two')`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  // ── Pre-0049 state (trigger not yet installed) ───────────────────────────────
  await makeUser(c, U.preAdminNull, "admin"); // admin, workspace null
  await makeUser(c, U.preAdminBound, "admin"); // admin, will bind to WS2 below
  await c.query(`update public.profiles set workspace_id='${WS2}' where id='${U.preAdminBound}'`);
  await makeUser(c, U.preClient, "client"); // client, null
  check("pre-0049: admin has NULL workspace (no trigger yet)", (await wsOf(c, U.preAdminNull)) === null);
  check("pre-0049: bound admin is on WS2", (await wsOf(c, U.preAdminBound)) === WS2);

  // ── Apply the real migration (installs trigger + runs backfill) ──────────────
  await c.query(sqlFile("0049_admin_workspace_binding.sql"));

  // ── Structure ────────────────────────────────────────────────────────────────
  console.log("\n── Structure ──");
  check("assign_admin_workspace() exists", (await scalar(c, `select count(*)::int from pg_proc where proname='assign_admin_workspace'`)) === 1);
  check("assign_admin_workspace is SECURITY DEFINER", (await scalar(c, `select prosecdef from pg_proc where proname='assign_admin_workspace'`)) === true);
  check("BEFORE INSERT trigger present on profiles",
    (await scalar(c, `select count(*)::int from pg_trigger t join pg_class r on r.oid=t.tgrelid
       where r.relname='profiles' and t.tgname='profiles_assign_admin_workspace' and not t.tgisinternal`)) === 1);

  // ── Backfill (existing admins) ───────────────────────────────────────────────
  console.log("\n── Backfill ──");
  check("existing NULL-workspace admin backfilled to agency workspace", (await wsOf(c, U.preAdminNull)) === WS);
  check("existing admin already bound to WS2 is NOT overwritten", (await wsOf(c, U.preAdminBound)) === WS2);
  check("existing client stays NULL", (await wsOf(c, U.preClient)) === null);

  // ── New profiles (trigger active) ────────────────────────────────────────────
  console.log("\n── New profiles via the auth trigger ──");
  await makeUser(c, U.newAdmin, "admin");
  check("NEW admin auto-bound to agency workspace", (await wsOf(c, U.newAdmin)) === WS);

  await makeUser(c, U.newClient, "client");
  check("NEW client → NULL (unchanged)", (await wsOf(c, U.newClient)) === null);
  await makeUser(c, U.newRep, "rep");
  check("NEW rep → NULL (unchanged)", (await wsOf(c, U.newRep)) === null);

  // NEW admin that already carries a workspace (e.g. a future direct provisioner)
  // must not be overwritten. handle_new_user doesn't set it, so set via a direct
  // profile insert to exercise the trigger's null-guard on a preset value.
  await c.query(`insert into auth.users (id,email) values ('${U.newAdminPreset}','preset@t')`).catch(() => {});
  await c.query(`insert into public.profiles (id,role,workspace_id) values ('${U.newAdminPreset}','admin','${WS2}')
                 on conflict (id) do update set role='admin', workspace_id='${WS2}'`);
  check("NEW admin inserted WITH a workspace preset is not overwritten (null-guard)", (await wsOf(c, U.newAdminPreset)) === WS2);

  // ── Fail-closed: agency workspace absent ─────────────────────────────────────
  console.log("\n── Fail-closed (agency workspace missing) ──");
  await c.query(`update public.workspaces set slug='bbettr-agency-RENAMED' where slug='bbettr-agency'`);
  const r = await c.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,'{"role":"admin"}'::jsonb)`,
    [U.failClosedAdmin, "fc@t"]).then(() => ({ error: null })).catch((e) => ({ error: e }));
  check("new admin insert SUCCEEDS when agency workspace is missing (not blocked)", r.error === null, r.error?.message);
  check("that admin's workspace is NULL (fail-closed, not a bogus binding)", (await wsOf(c, U.failClosedAdmin)) === null);
  await c.query(`update public.workspaces set slug='bbettr-agency' where slug='bbettr-agency-RENAMED'`); // restore

  // ── Idempotency ──────────────────────────────────────────────────────────────
  console.log("\n── Idempotency ──");
  const rerun = await c.query(`update public.profiles set workspace_id = (select id from public.workspaces where slug='bbettr-agency')
     where role='admin' and workspace_id is null and exists (select 1 from public.workspaces where slug='bbettr-agency')`)
    .then(() => ({ error: null })).catch((e) => ({ error: e }));
  check("re-running the backfill does not error", rerun.error === null, rerun.error?.message);
  check("bound admins unchanged after re-run (WS / WS2 preserved)",
    (await wsOf(c, U.preAdminNull)) === WS && (await wsOf(c, U.preAdminBound)) === WS2);
  check("the fail-closed admin (still NULL) is bound once the workspace exists again",
    (await wsOf(c, U.failClosedAdmin)) === WS);

  console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
