/**
 * Bbettr OS — Migration 0061 (membership authorization / tenant RLS) proof — S2.
 *
 * Builds a representative REAL tenant scaffold (direct client_id tables, a
 * client-writable table, files with visibility/category, an indirect
 * success-manager relationship, and Supabase Storage path RLS), each with its
 * PRE-0061 current_client_id() policies, then applies the REAL 0050 (profile
 * guard) + 0060 (client_members + is_client_member + sync trigger) + 0061 and
 * proves the S2 security matrix against a disposable local PostgreSQL:
 *
 *   Identities:  User A → members {A,B}, legacy profiles.client_id=A
 *                User B → member  {C},   legacy profiles.client_id=C
 *                Admin  → NO membership
 *
 *   - backward compatibility: current_client_id() still resolves the LEGACY
 *     workspace (A for User A, C for User B) — deterministic, never a second
 *     membership;
 *   - authorization is membership: User A reads/writes A AND B, never C; User B
 *     only C; admin reads all with no membership;
 *   - writes (INSERT/UPDATE/DELETE) enforce membership via WITH CHECK — no
 *     inserting/moving/updating/deleting a non-member workspace's rows;
 *   - indirect (success manager) + Storage path RLS are membership-aware;
 *   - client_members stays independently protected (no self-grant/modify);
 *   - profiles privileged-column guard (0050) still blocks legacy client_id
 *     changes; the provisioning sync trigger still mints memberships post-0061.
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth+storage. Disposable "*test*" only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("0061: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("0061: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
}

const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  A: "00000000-0000-0000-0000-0000000000c1",
  B: "00000000-0000-0000-0000-0000000000c2",
  D: "00000000-0000-0000-0000-0000000000c4", // provisioned AFTER 0061
};
const CL = {
  A: "00000000-0000-0000-0000-0000000000ca",
  B: "00000000-0000-0000-0000-0000000000cb",
  C: "00000000-0000-0000-0000-0000000000cc",
  D: "00000000-0000-0000-0000-0000000000cd", // provisioning target
};
const SMA = "00000000-0000-0000-0000-00000000e5a1"; // success manager for Client A
const SMB = "00000000-0000-0000-0000-00000000e5b1"; // success manager for Client B
const SMC = "00000000-0000-0000-0000-00000000e5c1"; // success manager for Client C

// Direct client_id tenant tables + the column that carries the tenant key.
const DIRECT = [
  ["project_stages", "client_id"],
  ["updates", "client_id"],
  ["reports", "client_id"],
  ["client_services", "client_id"],
  ["activity_events", "client_id"],
  ["notifications", "client_id"],
  ["client_invoices", "client_id"],
  ["client_billing_details", "client_id"],
  ["update_reactions", "client_id"],
  ["onboarding_submissions", "client_id"],
];

// Build the scaffold: identity, helpers, tenant tables with PRE-0061 policies.
function scaffold() {
  const tbl = (name, extraCols, seedCols, seedVals) => `
create table public.${name} (id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete cascade${extraCols});
grant select, insert, update, delete on public.${name} to authenticated;
alter table public.${name} enable row level security;
create policy "Admins manage all ${name}" on public.${name} for all to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.${name} (client_id${seedCols}) values ('${CL.A}'${seedVals}),('${CL.B}'${seedVals}),('${CL.C}'${seedVals});`;

  return `
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub','')::uuid $fn$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then
  create type public.user_role as enum ('admin','client','rep'); end if; end $$;

create table public.clients (id uuid primary key default gen_random_uuid(), name text, success_manager_id uuid);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  workspace_id uuid,
  full_name text);

create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_client_id() returns uuid
  language sql security definer set search_path=public stable as $fn$
  select client_id from profiles where id = auth.uid(); $fn$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $fn$
  begin new.updated_at = now(); return new; end; $fn$;

grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

grant select on public.clients to authenticated;
alter table public.clients enable row level security;
create policy "Admins manage all clients" on public.clients for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Clients read own tenant" on public.clients for select to authenticated using (id = public.current_client_id());

-- team_members (indirect: read the success manager assigned to your workspace)
create table public.team_members (id uuid primary key, name text, is_default boolean default false);
grant select on public.team_members to authenticated;
alter table public.team_members enable row level security;
create policy "Admins manage team members" on public.team_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Clients read their success manager" on public.team_members for select to authenticated
  using (exists (select 1 from public.clients c where c.id = public.current_client_id() and c.success_manager_id = team_members.id));
insert into public.team_members (id,name) values ('${SMA}','SM A'),('${SMB}','SM B'),('${SMC}','SM C');

-- Seed identities + clients (success managers wired per client)
insert into auth.users (id,email) values ('${U.admin}','admin@t'),('${U.A}','a@t'),('${U.B}','b@t');
insert into public.clients (id,name,success_manager_id) values
  ('${CL.A}','Client A','${SMA}'),('${CL.B}','Client B','${SMB}'),('${CL.C}','Client C','${SMC}');
insert into public.profiles (id,role,client_id,full_name) values
  ('${U.admin}','admin',null,'Admin'),('${U.A}','client','${CL.A}','A'),('${U.B}','client','${CL.C}','B');

-- Representative direct-tenant tables with PRE-0061 (current_client_id) policies.
${tbl("project_stages", "", "", "")}
create policy "Clients read own stages" on public.project_stages for select to authenticated using (client_id = public.current_client_id());
${tbl("updates", "", "", "")}
create policy "Clients read own updates" on public.updates for select to authenticated using (client_id = public.current_client_id());
${tbl("reports", "", "", "")}
create policy "Clients read own reports" on public.reports for select to authenticated using (client_id = public.current_client_id());
${tbl("client_services", "", "", "")}
create policy "Clients read own services" on public.client_services for select to authenticated using (client_id = public.current_client_id());
${tbl("activity_events", ", visibility text not null default 'client'", "", "")}
create policy "Clients read own visible activity" on public.activity_events for select to authenticated using (client_id = public.current_client_id() and visibility = 'client');
${tbl("notifications", "", "", "")}
create policy "Clients read own notifications" on public.notifications for select to authenticated using (client_id = public.current_client_id());
create policy "Clients update own notifications" on public.notifications for update to authenticated using (client_id = public.current_client_id()) with check (client_id = public.current_client_id());
${tbl("client_invoices", ", status text not null default 'sent'", "", "")}
create policy "Clients read own invoices" on public.client_invoices for select to authenticated using (client_id = public.current_client_id() and status <> 'draft');
${tbl("client_billing_details", "", "", "")}
create policy "Clients read own billing details" on public.client_billing_details for select to authenticated using (client_id = public.current_client_id());
create policy "Clients insert own billing details" on public.client_billing_details for insert to authenticated with check (client_id = public.current_client_id());
create policy "Clients update own billing details" on public.client_billing_details for update to authenticated using (client_id = public.current_client_id()) with check (client_id = public.current_client_id());
${tbl("update_reactions", "", "", "")}
create policy "Clients read own update reactions" on public.update_reactions for select to authenticated using (client_id = public.current_client_id());
create policy "Clients add own update reactions" on public.update_reactions for insert to authenticated with check (client_id = public.current_client_id());
create policy "Clients change own update reactions" on public.update_reactions for update to authenticated using (client_id = public.current_client_id()) with check (client_id = public.current_client_id());
create policy "Clients remove own update reactions" on public.update_reactions for delete to authenticated using (client_id = public.current_client_id());
${tbl("onboarding_submissions", "", "", "")}
create policy "Clients read own onboarding" on public.onboarding_submissions for select to authenticated using (client_id = public.current_client_id());
create policy "Clients insert own onboarding" on public.onboarding_submissions for insert to authenticated with check (client_id = public.current_client_id());
create policy "Clients update own onboarding" on public.onboarding_submissions for update to authenticated using (client_id = public.current_client_id()) with check (client_id = public.current_client_id());
${tbl("contracts", "", "", "")}
create policy "Clients read own contracts" on public.contracts for select to authenticated using (client_id = public.current_client_id());
${tbl("update_questions", "", "", "")}
create policy "Clients read own update questions" on public.update_questions for select to authenticated using (client_id = public.current_client_id());
create policy "Clients raise own update questions" on public.update_questions for insert to authenticated with check (client_id = public.current_client_id());

-- client_section_views (composite PK, no id column)
create table public.client_section_views (client_id uuid not null references public.clients(id) on delete cascade, section text not null, last_viewed_at timestamptz not null default now(), primary key (client_id, section));
grant select, insert, update, delete on public.client_section_views to authenticated;
alter table public.client_section_views enable row level security;
create policy "Admins read all section views" on public.client_section_views for select to authenticated using (public.is_admin());
create policy "Clients read own section views" on public.client_section_views for select to authenticated using (client_id = public.current_client_id());
create policy "Clients insert own section views" on public.client_section_views for insert to authenticated with check (client_id = public.current_client_id());
create policy "Clients update own section views" on public.client_section_views for update to authenticated using (client_id = public.current_client_id()) with check (client_id = public.current_client_id());
insert into public.client_section_views (client_id, section) values ('${CL.A}','project'),('${CL.B}','project'),('${CL.C}','project');

-- files (visibility + category + delete)
create table public.files (id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete cascade, client_visible boolean not null default true, asset_category text not null default 'documents');
grant select, insert, update, delete on public.files to authenticated;
alter table public.files enable row level security;
create policy "Admins manage all files" on public.files for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Clients read own files" on public.files for select to authenticated using (client_id = public.current_client_id() and client_visible = true);
create policy "Clients insert own files" on public.files for insert to authenticated with check (client_id = public.current_client_id() and asset_category in ('branding','website_content','media','documents'));
create policy "Clients delete own files" on public.files for delete to authenticated using (client_id = public.current_client_id());
insert into public.files (client_id, client_visible, asset_category) values ('${CL.A}',true,'documents'),('${CL.B}',true,'documents'),('${CL.C}',true,'documents');

-- Supabase Storage (path <client_id>/...) with PRE-0061 policies.
create table storage.buckets (id text primary key, name text, public boolean);
insert into storage.buckets values ('client-files','client-files',false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
  select (string_to_array(name,'/'))[1:greatest(coalesce(array_length(string_to_array(name,'/'),1),0)-1,0)] $fn$;
grant select, insert, update, delete on storage.objects to authenticated;
alter table storage.objects enable row level security;
create policy "Read client files" on storage.objects for select using (bucket_id='client-files' and (public.is_admin() or (storage.foldername(name))[1] = public.current_client_id()::text));
create policy "Upload client files" on storage.objects for insert with check (bucket_id='client-files' and (public.is_admin() or (storage.foldername(name))[1] = public.current_client_id()::text));
create policy "Delete client files" on storage.objects for delete using (bucket_id='client-files' and (public.is_admin() or (storage.foldername(name))[1] = public.current_client_id()::text));
insert into storage.objects (bucket_id, name) values ('client-files','${CL.A}/f.txt'),('client-files','${CL.B}/f.txt'),('client-files','${CL.C}/f.txt');
`;
}

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function scalar(c, sql, params = []) { const { rows } = await c.query(sql, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }
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
const CM = "public.client_members";

async function readCount(c, uid, table, col, clientId) {
  return (await runAs(c, "authenticated", uid, `select 1 from public.${table} where ${col}='${clientId}'`)).rowCount;
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; drop schema if exists storage cascade;`);
  await c.query(scaffold());

  // Apply the REAL guard + membership + authorization migrations, in order.
  await c.query(sqlFile("0050_profiles_guard_privileged_columns.sql"));
  await c.query(sqlFile("0060_client_members.sql"));        // backfills userA→A, userB→C; adds sync trigger + is_client_member
  await c.query(`insert into ${CM} (user_id, client_id) values ('${U.A}','${CL.B}')`); // simulate S3/S4 grant: User A also → Client B
  await c.query(sqlFile("0061_tenant_rls_membership.sql"));  // swap tenant RLS to membership

  // ── backward compatibility (current_client_id unchanged, deterministic) ────
  console.log("── backward compatibility ──");
  check("current_client_id() still resolves LEGACY A for User A (not B)", (await runAs(c, "authenticated", U.A, `select public.current_client_id()`)).rows[0].current_client_id === CL.A);
  check("current_client_id() still resolves C for User B", (await runAs(c, "authenticated", U.B, `select public.current_client_id()`)).rows[0].current_client_id === CL.C);
  check("User A is_client_member(A) TRUE", (await runAs(c, "authenticated", U.A, `select public.is_client_member('${CL.A}')`)).rows[0].is_client_member === true);
  check("User A is_client_member(B) TRUE (granted second membership)", (await runAs(c, "authenticated", U.A, `select public.is_client_member('${CL.B}')`)).rows[0].is_client_member === true);
  check("User A is_client_member(C) FALSE", (await runAs(c, "authenticated", U.A, `select public.is_client_member('${CL.C}')`)).rows[0].is_client_member === false);

  // ── SELECT authorization across representative direct tenant tables ────────
  console.log("\n── SELECT: membership authorizes A+B for User A, C for User B ──");
  for (const [t, col] of DIRECT) {
    const aA = await readCount(c, U.A, t, col, CL.A);
    const aB = await readCount(c, U.A, t, col, CL.B);
    const aC = await readCount(c, U.A, t, col, CL.C);
    check(`${t}: User A reads A(1)+B(1), NOT C(0)`, aA === 1 && aB === 1 && aC === 0, `A=${aA} B=${aB} C=${aC}`);
    const bC = await readCount(c, U.B, t, col, CL.C);
    const bA = await readCount(c, U.B, t, col, CL.A);
    check(`${t}: User B reads C(1), NOT A(0)`, bC === 1 && bA === 0, `C=${bC} A=${bA}`);
    const adm = (await runAs(c, "authenticated", U.admin, `select 1 from public.${t}`)).rowCount;
    check(`${t}: admin reads all (3) with no membership`, adm === 3, `admin=${adm}`);
  }
  // clients table (keyed by id)
  check("clients: User A reads A+B not C", (await readCount(c, U.A, "clients", "id", CL.A)) === 1 && (await readCount(c, U.A, "clients", "id", CL.B)) === 1 && (await readCount(c, U.A, "clients", "id", CL.C)) === 0);
  // files (client_visible)
  check("files: User A reads A+B not C", (await readCount(c, U.A, "files", "client_id", CL.A)) === 1 && (await readCount(c, U.A, "files", "client_id", CL.B)) === 1 && (await readCount(c, U.A, "files", "client_id", CL.C)) === 0);

  // ── INSERT authorization (WITH CHECK) ───────────────────────────────────────
  console.log("\n── INSERT (WITH CHECK) ──");
  check("User A CAN insert onboarding for A", (await runAs(c, "authenticated", U.A, `insert into public.onboarding_submissions (client_id) values ('${CL.A}')`)).rowCount === 1);
  check("User A CAN insert onboarding for B (member)", (await runAs(c, "authenticated", U.A, `insert into public.onboarding_submissions (client_id) values ('${CL.B}')`)).rowCount === 1);
  check("User A CANNOT insert onboarding for C (not a member)", denied(await runAs(c, "authenticated", U.A, `insert into public.onboarding_submissions (client_id) values ('${CL.C}')`)));
  check("User A CAN insert a media file for B", (await runAs(c, "authenticated", U.A, `insert into public.files (client_id, asset_category) values ('${CL.B}','media')`)).rowCount === 1);
  check("User A CANNOT insert a file for C", denied(await runAs(c, "authenticated", U.A, `insert into public.files (client_id, asset_category) values ('${CL.C}','media')`)));
  check("User B CANNOT insert onboarding for A", denied(await runAs(c, "authenticated", U.B, `insert into public.onboarding_submissions (client_id) values ('${CL.A}')`)));

  // ── UPDATE authorization (no cross-tenant move) ─────────────────────────────
  console.log("\n── UPDATE (no cross-tenant move) ──");
  check("User A CAN update its A onboarding row", (await runAs(c, "authenticated", U.A, `update public.onboarding_submissions set client_id='${CL.A}' where client_id='${CL.A}'`)).rowCount >= 1);
  check("User A CANNOT MOVE an A row to C (WITH CHECK blocks)", denied(await runAs(c, "authenticated", U.A, `update public.onboarding_submissions set client_id='${CL.C}' where client_id='${CL.A}'`)));
  check("User A CANNOT update a C row (invisible)", denied(await runAs(c, "authenticated", U.A, `update public.onboarding_submissions set client_id='${CL.C}' where client_id='${CL.C}'`)));
  check("User A CAN mark a B notification (member)", (await runAs(c, "authenticated", U.A, `update public.notifications set client_id='${CL.B}' where client_id='${CL.B}'`)).rowCount >= 1);

  // ── DELETE authorization ────────────────────────────────────────────────────
  console.log("\n── DELETE ──");
  check("User A CAN delete a B update-reaction (member)", (await runAs(c, "authenticated", U.A, `delete from public.update_reactions where client_id='${CL.B}'`)).rowCount >= 1);
  check("User A CANNOT delete a C update-reaction", (await runAs(c, "authenticated", U.A, `delete from public.update_reactions where client_id='${CL.C}'`)).rowCount === 0);
  check("User A CANNOT delete a C file", (await runAs(c, "authenticated", U.A, `delete from public.files where client_id='${CL.C}'`)).rowCount === 0);

  // ── indirect: success manager ───────────────────────────────────────────────
  console.log("\n── indirect (success manager) ──");
  check("User A reads SM of A and B, not C", (await runAs(c, "authenticated", U.A, `select id from public.team_members`)).rowCount === 2
    && (await runAs(c, "authenticated", U.A, `select 1 from public.team_members where id='${SMC}'`)).rowCount === 0);
  check("User B reads only SM of C", (await runAs(c, "authenticated", U.B, `select id from public.team_members`)).rowCount === 1
    && (await runAs(c, "authenticated", U.B, `select 1 from public.team_members where id='${SMC}'`)).rowCount === 1);

  // ── Storage path RLS ─────────────────────────────────────────────────────────
  console.log("\n── storage path RLS ──");
  const so = (uid, cid) => runAs(c, "authenticated", uid, `select 1 from storage.objects where name='${cid}/f.txt'`);
  check("User A reads A + B objects, not C", (await so(U.A, CL.A)).rowCount === 1 && (await so(U.A, CL.B)).rowCount === 1 && (await so(U.A, CL.C)).rowCount === 0);
  check("User A CAN upload into B folder, not C", (await runAs(c, "authenticated", U.A, `insert into storage.objects (bucket_id,name) values ('client-files','${CL.B}/new.txt')`)).rowCount === 1
    && denied(await runAs(c, "authenticated", U.A, `insert into storage.objects (bucket_id,name) values ('client-files','${CL.C}/new.txt')`)));
  check("User B reads only C object", (await so(U.B, CL.C)).rowCount === 1 && (await so(U.B, CL.A)).rowCount === 0);
  check("admin reads all objects", (await runAs(c, "authenticated", U.admin, `select 1 from storage.objects`)).rowCount === 3);

  // ── client_members isolation preserved (S1 guarantees) ─────────────────────
  console.log("\n── membership-table isolation (unchanged) ──");
  check("User A sees ONLY its own memberships (A,B)", (await runAs(c, "authenticated", U.A, `select client_id from ${CM}`)).rowCount === 2);
  check("User A CANNOT self-grant C", denied(await runAs(c, "authenticated", U.A, `insert into ${CM} (user_id, client_id) values ('${U.A}','${CL.C}')`)));
  check("User A CANNOT grant another user", denied(await runAs(c, "authenticated", U.A, `insert into ${CM} (user_id, client_id) values ('${U.B}','${CL.A}')`)));
  check("User A CANNOT move a membership to C", denied(await runAs(c, "authenticated", U.A, `update ${CM} set client_id='${CL.C}' where user_id='${U.A}' and client_id='${CL.A}'`)));
  check("User A CANNOT delete a membership", denied(await runAs(c, "authenticated", U.A, `delete from ${CM} where user_id='${U.A}'`)));
  check("granting a membership does NOT leak into other users", (await runAs(c, "authenticated", U.B, `select 1 from ${CM} where client_id='${CL.A}'`)).rowCount === 0);

  // ── profile guard (0050) regression ─────────────────────────────────────────
  console.log("\n── profiles guard (0050) regression ──");
  {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U.A, role: "authenticated" })]);
    await c.query(`update public.profiles set client_id='${CL.C}' where id='${U.A}'`).catch(() => {});
    await c.query("reset role");
    const cid = (await c.query(`select client_id from public.profiles where id='${U.A}'`)).rows[0].client_id;
    await c.query("rollback");
    check("client CANNOT change legacy profiles.client_id (guard holds → stays A)", cid === CL.A);
  }
  // And even the DB state can't be used to reach C, because authorization is membership:
  check("User A still cannot read C after attempting the guarded change", (await readCount(c, U.A, "project_stages", "client_id", CL.C)) === 0);

  // ── provisioning sync trigger still works post-0061 (end-to-end) ────────────
  console.log("\n── provisioning sync (0060 trigger) still live under 0061 ──");
  await c.query(`insert into auth.users (id,email) values ('${U.D}','d@t')`);
  await c.query(`insert into public.clients (id,name) values ('${CL.D}','Client D')`);
  await c.query(`insert into public.project_stages (client_id) values ('${CL.D}')`);
  await c.query(`insert into public.profiles (id,role,client_id,full_name) values ('${U.D}','client','${CL.D}','D')`);
  check("new profile auto-mints membership (trigger)", (await scalar(c, `select count(*)::int from ${CM} where user_id='${U.D}' and client_id='${CL.D}'`)) === 1);
  check("…and that membership immediately authorizes tenant reads", (await readCount(c, U.D, "project_stages", "client_id", CL.D)) === 1
    && (await readCount(c, U.D, "project_stages", "client_id", CL.A)) === 0);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0061 TENANT-MEMBERSHIP-RLS CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
