/**
 * Bbettr OS — Migration 0060 (client_members) proof — Multi-Workspace S1.
 *
 * Applies the REAL 0060 on a minimal Portal-identity scaffold (auth/roles,
 * clients, profiles, is_admin, current_client_id, a representative tenant table
 * with the EXISTING legacy RLS) against a disposable local PostgreSQL, and
 * proves the locked S1 design + security matrix:
 *
 *   - structure: columns/types/nullability; surrogate PK; UNIQUE(user_id,
 *     client_id); role CHECK; both FKs ON DELETE CASCADE; client_id index;
 *     RLS enabled; exactly two policies; base grants;
 *   - backfill: every role='client' + client_id IS NOT NULL profile becomes an
 *     equivalent membership; nobody else; profiles/clients untouched; idempotent;
 *   - going-forward sync trigger: new/updated client-role profiles get the
 *     membership; null client_id / admin profiles do NOT;
 *   - FK cascade: deleting a client, or an auth user, removes the membership;
 *   - duplicate protection: UNIQUE blocks a second (user_id, client_id);
 *   - RLS isolation (as PostgREST would): a client reads ONLY its own membership
 *     and cannot enumerate/insert/update/delete across users or workspaces; anon
 *     denied; admin manages all;
 *   - is_client_member() helper behaviour;
 *   - EXISTING TENANT RLS REGRESSION: tenant data still authorizes from
 *     current_client_id() ONLY — a membership does NOT grant tenant access.
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("0060: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("0060: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  A: "00000000-0000-0000-0000-0000000000c1",
  B: "00000000-0000-0000-0000-0000000000c2",
  ghost: "00000000-0000-0000-0000-0000000000c9", // client role, NULL client_id
  none: "00000000-0000-0000-0000-0000000000f1",
};
const CL = {
  A: "00000000-0000-0000-0000-0000000000ca",
  B: "00000000-0000-0000-0000-0000000000cb",
  C: "00000000-0000-0000-0000-0000000000cc", // for going-forward + cascade
  D: "00000000-0000-0000-0000-0000000000cd", // for auth-user cascade
};
const U_C = "00000000-0000-0000-0000-0000000000c3"; // new profile provisioned post-migration
const U_D = "00000000-0000-0000-0000-0000000000c4"; // for auth-user cascade

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
  workspace_id uuid,                         -- present so the REAL 0050 guard applies
  full_name text);

create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid
  language sql security definer set search_path=public stable as $fn$
  select client_id from profiles where id = auth.uid(); $fn$;

grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
-- Real 0002 self-update policy: pins only the row id (the 0050 guard is what
-- protects the privileged columns) — needed to exercise guard+sync coexistence.
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Representative EXISTING tenant table with the legacy RLS (0002 convention):
-- "Admins manage all" + "Clients read own" via current_client_id(). Used for the
-- tenant-RLS regression proof.
create table public.tenant_rows (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  body text);
grant select, insert, update, delete on public.tenant_rows to authenticated;
alter table public.tenant_rows enable row level security;
create policy tenant_admin on public.tenant_rows for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy tenant_client_read on public.tenant_rows for select to authenticated
  using (client_id = public.current_client_id());

insert into auth.users (id,email) values
  ('${U.admin}','admin@t'),('${U.A}','a@t'),('${U.B}','b@t'),('${U.ghost}','g@t'),('${U.none}','n@t');
insert into public.clients (id,name) values ('${CL.A}','Client A'),('${CL.B}','Client B');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin}','admin',null,'Admin'),
  ('${U.A}','client','${CL.A}','A'),
  ('${U.B}','client','${CL.B}','B'),
  ('${U.ghost}','client',null,'Ghost');       -- client role but NO workspace yet
insert into public.tenant_rows (client_id, body) values ('${CL.A}','a-row'),('${CL.B}','b-row');
`;

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, sql, params = []) { const { rows } = await c.query(sql, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function tryQuery(c, sql, params = []) {
  try { const r = await c.query(sql, params); return { ok: true, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { return { ok: false, rowCount: 0, error: e }; }
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
const denied = (r) => r.error !== null || r.rowCount === 0;
const T = "public.client_members";

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  const profilesBefore = await scalar(c, `select count(*)::int from public.profiles`);
  const clientsBefore = await scalar(c, `select count(*)::int from public.clients`);
  const profilesColsBefore = await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='profiles'`);
  const clientsColsBefore = await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='clients'`);

  // Apply the REAL 0050 privileged-column guard FIRST (as in production order),
  // so 0060's profiles trigger is proven to coexist with it.
  await c.query(readFileSync(join(MIG, "0050_profiles_guard_privileged_columns.sql"), "utf8"));
  await c.query(readFileSync(join(MIG, "0060_client_members.sql"), "utf8"));

  // ── structure ──────────────────────────────────────────────────────────────
  console.log("── structure ──");
  const col = async (n) => (await c.query(
    `select data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='client_members' and column_name=$1`, [n])).rows[0];
  check("table exists", (await scalar(c, `select to_regclass('${T}') is not null`)) === true);
  check("id uuid PK w/ default", (await col("id"))?.data_type === "uuid" && String((await col("id"))?.column_default || "").includes("gen_random_uuid"));
  check("user_id uuid NOT NULL", (await col("user_id"))?.data_type === "uuid" && (await col("user_id"))?.is_nullable === "NO");
  check("client_id uuid NOT NULL", (await col("client_id"))?.data_type === "uuid" && (await col("client_id"))?.is_nullable === "NO");
  check("role text NOT NULL default 'member'", (await col("role"))?.data_type === "text" && String((await col("role"))?.column_default || "").includes("member"));
  check("created_at timestamptz NOT NULL", (await col("created_at"))?.data_type === "timestamp with time zone" && (await col("created_at"))?.is_nullable === "NO");

  const pk = await scalar(c, `select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid='${T}'::regclass and i.indisprimary`);
  check("primary key is id (surrogate)", pk === "id");
  check("UNIQUE(user_id, client_id) present", (await scalar(c,
    `select count(*)::int from pg_constraint where conrelid='${T}'::regclass and contype='u'
       and pg_get_constraintdef(oid) ilike '%(user_id, client_id)%'`)) === 1);
  check("role CHECK restricts to 'member'", (await scalar(c,
    `select count(*)::int from pg_constraint where conrelid='${T}'::regclass and contype='c'
       and pg_get_constraintdef(oid) ilike '%role%member%'`)) === 1);
  check("client_id index exists", (await scalar(c, `select count(*)::int from pg_indexes where schemaname='public' and tablename='client_members' and indexname='client_members_client_id_idx'`)) === 1);

  const delRule = async (cn) => scalar(c,
    `select rc.delete_rule from information_schema.referential_constraints rc
       join information_schema.key_column_usage kcu on kcu.constraint_name=rc.constraint_name
      where kcu.table_schema='public' and kcu.table_name='client_members' and kcu.column_name=$1`, [cn]);
  check("user_id FK ON DELETE CASCADE", (await delRule("user_id")) === "CASCADE");
  check("client_id FK ON DELETE CASCADE", (await delRule("client_id")) === "CASCADE");

  check("RLS enabled", (await scalar(c, `select relrowsecurity from pg_class where oid='${T}'::regclass`)) === true);
  check("exactly 2 policies (admin manage + user self-read)", (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='client_members'`)) === 2);
  check("authenticated has base grants", (await scalar(c,
    `select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name='client_members' and grantee='authenticated'`)) >= 1);

  // ── backfill ─────────────────────────────────────────────────────────────
  console.log("\n── backfill ──");
  check("userA → Client A membership created", (await scalar(c, `select count(*)::int from ${T} where user_id='${U.A}' and client_id='${CL.A}'`)) === 1);
  check("userB → Client B membership created", (await scalar(c, `select count(*)::int from ${T} where user_id='${U.B}' and client_id='${CL.B}'`)) === 1);
  check("backfilled role = 'member'", (await scalar(c, `select bool_and(role='member') from ${T}`)) === true);
  check("EXACTLY 2 memberships (admin + null-client-id ghost excluded)", (await scalar(c, `select count(*)::int from ${T}`)) === 2);
  check("admin got NO membership", (await scalar(c, `select count(*)::int from ${T} where user_id='${U.admin}'`)) === 0);
  check("ghost (client, null client_id) got NO membership", (await scalar(c, `select count(*)::int from ${T} where user_id='${U.ghost}'`)) === 0);
  check("profiles.client_id UNCHANGED (userA still → A)", (await scalar(c, `select client_id from public.profiles where id='${U.A}'`)) === CL.A);
  check("profiles row count unchanged", (await scalar(c, `select count(*)::int from public.profiles`)) === profilesBefore);
  check("clients row count unchanged", (await scalar(c, `select count(*)::int from public.clients`)) === clientsBefore);
  check("no column added to profiles", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='profiles'`)) === profilesColsBefore);
  check("no column added to clients", (await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='clients'`)) === clientsColsBefore);
  check("backfill is idempotent (re-run inserts nothing)", (await tryQuery(c,
    `insert into ${T} (user_id, client_id, role) select p.id, p.client_id, 'member' from public.profiles p where p.role='client' and p.client_id is not null on conflict (user_id, client_id) do nothing`)).ok
    && (await scalar(c, `select count(*)::int from ${T}`)) === 2);

  // ── duplicate protection ──────────────────────────────────────────────────
  console.log("\n── duplicate protection ──");
  check("duplicate (userA, ClientA) rejected by UNIQUE", !(await tryQuery(c, `insert into ${T} (user_id, client_id) values ('${U.A}','${CL.A}')`)).ok);

  // ── RLS isolation (as PostgREST authenticated) ────────────────────────────
  console.log("\n── RLS isolation ──");
  const aReadAll = await runAs(c, "authenticated", U.A, `select user_id, client_id from ${T}`);
  check("userA reads ONLY its own membership (1 row)", aReadAll.rowCount === 1 && aReadAll.rows[0].user_id === U.A && aReadAll.rows[0].client_id === CL.A);
  check("userA CANNOT see userB's membership", (await runAs(c, "authenticated", U.A, `select id from ${T} where user_id='${U.B}'`)).rowCount === 0);
  check("userA CANNOT enumerate Client B memberships", (await runAs(c, "authenticated", U.A, `select id from ${T} where client_id='${CL.B}'`)).rowCount === 0);
  check("userA CANNOT grant itself Client B", denied(await runAs(c, "authenticated", U.A, `insert into ${T} (user_id, client_id) values ('${U.A}','${CL.B}')`)));
  check("userA CANNOT insert a membership for another user", denied(await runAs(c, "authenticated", U.A, `insert into ${T} (user_id, client_id) values ('${U.B}','${CL.A}')`)));
  check("userA CANNOT move its membership to Client B (no update policy)", denied(await runAs(c, "authenticated", U.A, `update ${T} set client_id='${CL.B}' where user_id='${U.A}'`)));
  check("userA CANNOT delete its membership (no delete policy)", denied(await runAs(c, "authenticated", U.A, `delete from ${T} where user_id='${U.A}'`)));
  check("anon CANNOT read", denied(await runAs(c, "anon", null, `select id from ${T}`)));
  check("anon CANNOT insert", denied(await runAs(c, "anon", null, `insert into ${T} (user_id, client_id) values ('${U.A}','${CL.B}')`)));

  // ── admin access ──────────────────────────────────────────────────────────
  console.log("\n── admin access ──");
  check("admin CAN read all memberships", (await runAs(c, "authenticated", U.admin, `select id from ${T}`)).rowCount === 2);
  check("admin CAN create a membership (S2 attach path)", (await runAs(c, "authenticated", U.admin, `insert into ${T} (user_id, client_id) values ('${U.A}','${CL.B}')`)).rowCount === 1);
  check("admin CAN delete a membership", (await runAs(c, "authenticated", U.admin, `delete from ${T} where user_id='${U.A}' and client_id='${CL.A}'`)).rowCount === 1);
  check("admin update to an invalid role rejected by CHECK", denied(await runAs(c, "authenticated", U.admin, `update ${T} set role='owner' where user_id='${U.A}'`)));

  // ── is_client_member() helper ─────────────────────────────────────────────
  console.log("\n── is_client_member() ──");
  check("is_client_member(A) TRUE for userA", (await runAs(c, "authenticated", U.A, `select public.is_client_member('${CL.A}')`)).rows[0].is_client_member === true);
  check("is_client_member(B) FALSE for userA", (await runAs(c, "authenticated", U.A, `select public.is_client_member('${CL.B}')`)).rows[0].is_client_member === false);
  check("is_client_member(A) FALSE for ghost (no membership)", (await runAs(c, "authenticated", U.ghost, `select public.is_client_member('${CL.A}')`)).rows[0].is_client_member === false);

  // ── EXISTING TENANT RLS REGRESSION (critical) ─────────────────────────────
  console.log("\n── tenant-RLS regression (legacy current_client_id ONLY) ──");
  check("userA CAN read Client A tenant rows (legacy path)", (await runAs(c, "authenticated", U.A, `select id from public.tenant_rows where client_id='${CL.A}'`)).rowCount === 1);
  check("userA CANNOT read Client B tenant rows", (await runAs(c, "authenticated", U.A, `select id from public.tenant_rows where client_id='${CL.B}'`)).rowCount === 0);
  // Give ghost a MEMBERSHIP to A (persistent) but keep profiles.client_id NULL.
  await c.query(`insert into ${T} (user_id, client_id) values ('${U.ghost}','${CL.A}')`);
  check("ghost now HAS is_client_member(A)=true", (await runAs(c, "authenticated", U.ghost, `select public.is_client_member('${CL.A}')`)).rows[0].is_client_member === true);
  check("…yet ghost STILL cannot read Client A tenant rows (membership ≠ tenant auth)", (await runAs(c, "authenticated", U.ghost, `select id from public.tenant_rows where client_id='${CL.A}'`)).rowCount === 0);
  await c.query(`delete from ${T} where user_id='${U.ghost}' and client_id='${CL.A}'`); // restore count

  // ── going-forward provisioning sync trigger ────────────────────────────────
  console.log("\n── going-forward sync trigger ──");
  await c.query(`insert into public.clients (id,name) values ('${CL.C}','Client C'),('${CL.D}','Client D')`);
  await c.query(`insert into auth.users (id,email) values ('${U_C}','c@t'),('${U_D}','d@t')`);
  // New client-role profile with a workspace → membership auto-created.
  await c.query(`insert into public.profiles (id,role,client_id,full_name) values ('${U_C}','client','${CL.C}','C')`);
  check("new client profile auto-gets membership (INSERT trigger)", (await scalar(c, `select count(*)::int from ${T} where user_id='${U_C}' and client_id='${CL.C}'`)) === 1);
  // Assigning a workspace to the previously-null ghost → membership on UPDATE.
  await c.query(`update public.profiles set client_id='${CL.B}' where id='${U.ghost}'`);
  check("assigning client_id later creates membership (UPDATE trigger)", (await scalar(c, `select count(*)::int from ${T} where user_id='${U.ghost}' and client_id='${CL.B}'`)) === 1);
  // A brand-new client profile WITHOUT a workspace → NO membership.
  await c.query(`insert into public.profiles (id,role,client_id,full_name) values ('${U_D}','client',null,'D-null')`);
  check("null-client-id profile creates NO membership", (await scalar(c, `select count(*)::int from ${T} where user_id='${U_D}'`)) === 0);
  // An admin profile (even if it later gets a client_id) → NO membership.
  await c.query(`update public.profiles set client_id='${CL.D}' where id='${U_D}'`); // still client role → gets membership
  check("client profile gaining a workspace via UPDATE gets membership", (await scalar(c, `select count(*)::int from ${T} where user_id='${U_D}' and client_id='${CL.D}'`)) === 1);

  // ── coexistence with the 0050 privileged-column guard ──────────────────────
  console.log("\n── guard (0050) + sync (0060) coexistence ──");
  {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U.A, role: "authenticated" })]);
    // Untrusted client tries to move itself to Client B by editing its profile.
    await c.query(`update public.profiles set client_id='${CL.B}' where id='${U.A}'`).catch(() => {});
    await c.query("reset role"); // observe true state as owner
    const cidAfter = (await c.query(`select client_id from public.profiles where id='${U.A}'`)).rows[0].client_id;
    const spurious = Number((await c.query(`select count(*)::int from ${T} where user_id='${U.A}' and client_id='${CL.B}'`)).rows[0].count);
    await c.query("rollback");
    check("0050 guard STILL holds: untrusted client_id change no-ops (stays A)", cidAfter === CL.A);
    check("no spurious membership created by a guarded (blocked) client_id change", spurious === 0);
  }

  // ── FK cascade ─────────────────────────────────────────────────────────────
  console.log("\n── FK cascade ──");
  await c.query(`delete from public.clients where id='${CL.C}'`);
  check("deleting a client CASCADE-removes its memberships", (await scalar(c, `select count(*)::int from ${T} where client_id='${CL.C}'`)) === 0);
  await c.query(`delete from auth.users where id='${U_D}'`);
  check("deleting an auth user CASCADE-removes its memberships", (await scalar(c, `select count(*)::int from ${T} where user_id='${U_D}'`)) === 0);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0060 CLIENT-MEMBERS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
