/**
 * Bbettr OS — Migration 0063 (Jarvis F1 append-only FK carve-out) DB proof.
 *
 * Applies the REAL 0062 THEN 0063 on a minimal agency scaffold and proves that
 * jarvis_action_events stays append-only while the four `on delete set null`
 * foreign keys can still nullify — so deleting a referenced profile/client/
 * proposal no longer aborts on the append-only guard.
 *
 * Proves:
 *   A. ordinary UPDATE is rejected
 *   B. ordinary DELETE is rejected
 *   C. a referenced profile / client / proposal can be deleted (FK -> NULL)
 *   D. the permitted FK mutation changes ONLY the permitted FK column(s)
 *   E. the carve-out cannot be abused to mutate any other field (or to set an
 *      FK to a different non-null value)
 *   F. RLS / workspace isolation is unchanged
 *   G. service_role privileges remain INSERT+SELECT only (no UPDATE/DELETE)
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
  const db = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(db) || /test/i.test(url))) throw new Error("0063: DB name must contain 'test'.");
}

const WS = "00000000-0000-0000-0000-0000000000e1";
const WS2 = "00000000-0000-0000-0000-0000000000e2";
const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",  // reader (kept alive for RLS)
  admin2: "00000000-0000-0000-0000-0000000000a2",  // bound to WS2
  del1: "00000000-0000-0000-0000-0000000000d1",    // initiated_by — deleted in C
  del2: "00000000-0000-0000-0000-0000000000d2",    // approval_by  — deleted in C
  client: "00000000-0000-0000-0000-0000000000c9",
};
const CL = "00000000-0000-0000-0000-0000000000ca";     // target_client_id — deleted in C

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
grant usage on schema auth, public to anon, authenticated, service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then create type public.user_role as enum ('admin','client','rep'); end if; end $$;

create table public.workspaces (id uuid primary key, name text, slug text unique);
create table public.clients (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  workspace_id uuid references public.workspaces(id));
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
create or replace function public.current_workspace_id() returns uuid
  language sql security definer set search_path=public stable as $fn$
  select workspace_id from profiles where id = auth.uid(); $fn$;
grant select, insert, update, delete on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());

insert into public.workspaces (id,name,slug) values ('${WS}','Agency','agency'),('${WS2}','Other','other');
insert into public.clients (id,name) values ('${CL}','Client A');
insert into auth.users (id,email) values
  ('${U.admin}','a@t'),('${U.admin2}','a2@t'),('${U.del1}','d1@t'),('${U.del2}','d2@t'),('${U.client}','c@t');
insert into public.profiles (id,role,client_id,workspace_id) values
  ('${U.admin}','admin',null,'${WS}'),
  ('${U.admin2}','admin',null,'${WS2}'),
  ('${U.del1}','admin',null,'${WS}'),
  ('${U.del2}','admin',null,'${WS}'),
  ('${U.client}','client','${CL}',null);
`;

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d && !ok ? "  — " + d : ""}`); ok ? pass++ : fail++; };
async function scalar(c, sql, p = []) { const { rows } = await c.query(sql, p); return rows[0] ? Object.values(rows[0])[0] : undefined; }
async function tryQ(c, sql, p = []) { try { const r = await c.query(sql, p); return { ok: true, rowCount: r.rowCount ?? 0 }; } catch (e) { return { ok: false, error: e }; } }
async function runAs(c, role, uid, sql, p = []) {
  try { await c.query("begin"); await c.query(`set local role ${role}`); await c.query(`select set_config('request.jwt.claims',$1,true)`, [uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })]); const r = await c.query(sql, p); await c.query("rollback"); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { await c.query("rollback").catch(() => {}); return { rows: [], rowCount: 0, error: e }; }
}
const denied = (r) => r.error !== null || r.rowCount === 0;

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(readFileSync(join(MIG, "0062_jarvis_foundation.sql"), "utf8"));
  await c.query(readFileSync(join(MIG, "0063_jarvis_action_events_fk_carveout.sql"), "utf8"));

  // Seed: a proposal (proposal_id target) and ONE action event referencing all
  // four ON DELETE SET NULL FKs.
  const PID = (await c.query(
    `insert into public.jarvis_proposals (workspace_id, capability_id, effect_hash, expires_at)
     values ('${WS}','portal.propose_internal_task','h', now()+interval '1 day') returning id`
  )).rows[0].id;
  await c.query(
    `insert into public.jarvis_action_events
       (workspace_id, actor_kind, initiated_by, capability_id, decision, target_client_id, proposal_id, approval_by, executed, success)
     values ('${WS}','human','${U.del1}','portal.propose_internal_task','allow','${CL}','${PID}','${U.del2}', true, true)`
  );
  const EID = (await c.query(`select event_id from public.jarvis_action_events limit 1`)).rows[0].event_id;

  console.log("── structure ──");
  check("carve-out function present", (await scalar(c, `select count(*)::int from pg_proc where proname='jarvis_action_events_reject_mutation'`)) === 1);
  check("append-only trigger present", (await scalar(c, `select count(*)::int from pg_trigger where tgname='jarvis_action_events_no_mutation'`)) === 1);

  console.log("\n── G: service_role privileges no broader than necessary ──");
  const privs = (await c.query(
    `select privilege_type from information_schema.role_table_grants
     where table_schema='public' and table_name='jarvis_action_events' and grantee='service_role' order by 1`
  )).rows.map((r) => r.privilege_type);
  check("service_role has exactly INSERT+SELECT", JSON.stringify(privs) === JSON.stringify(["INSERT", "SELECT"]), JSON.stringify(privs));
  check("service_role has NO UPDATE", !privs.includes("UPDATE"));
  check("service_role has NO DELETE", !privs.includes("DELETE"));

  console.log("\n── A/B: ordinary UPDATE + DELETE still rejected ──");
  check("A: ordinary UPDATE (success flip) rejected", !(await tryQ(c, `update public.jarvis_action_events set success=false where event_id='${EID}'`)).ok);
  check("B: DELETE rejected", !(await tryQ(c, `delete from public.jarvis_action_events where event_id='${EID}'`)).ok);

  console.log("\n── E: carve-out cannot be abused ──");
  // Null a FK BUT also change a protected column → must reject.
  check("E1: null initiated_by + flip success → rejected",
    !(await tryQ(c, `update public.jarvis_action_events set initiated_by=null, success=false where event_id='${EID}'`)).ok);
  // Change a FK to a DIFFERENT non-null value → must reject.
  check("E2: initiated_by non-null → different non-null → rejected",
    !(await tryQ(c, `update public.jarvis_action_events set initiated_by='${U.admin}' where event_id='${EID}'`)).ok);
  // Change only a protected column → must reject.
  check("E3: change decision only → rejected",
    !(await tryQ(c, `update public.jarvis_action_events set decision='deny' where event_id='${EID}'`)).ok);
  // Confirm the row is still fully intact after the rejected attempts.
  const intact = (await c.query(`select initiated_by, success, decision from public.jarvis_action_events where event_id='${EID}'`)).rows[0];
  check("E4: row unchanged after all abuse attempts", intact.initiated_by === U.del1 && intact.success === true && intact.decision === "allow");

  console.log("\n── F: RLS / workspace isolation unchanged ──");
  check("admin reads event in own workspace", (await runAs(c, "authenticated", U.admin, `select event_id from public.jarvis_action_events`)).rowCount === 1);
  check("client CANNOT read events", denied(await runAs(c, "authenticated", U.client, `select event_id from public.jarvis_action_events`)));
  check("admin in ANOTHER workspace sees none", (await runAs(c, "authenticated", U.admin2, `select event_id from public.jarvis_action_events`)).rowCount === 0);

  console.log("\n── C/D: FK nullification permitted, ONLY the FK column changes ──");
  // Snapshot every column before any delete.
  const before = (await c.query(`select * from public.jarvis_action_events where event_id='${EID}'`)).rows[0];

  const delProfile = await tryQ(c, `delete from public.profiles where id='${U.del1}'`);
  check("C1: deleting profile referenced by initiated_by SUCCEEDS", delProfile.ok, delProfile.error?.message);
  let row = (await c.query(`select * from public.jarvis_action_events where event_id='${EID}'`)).rows[0];
  check("D1: initiated_by is now NULL", row.initiated_by === null);
  check("D1: approval_by UNCHANGED", row.approval_by === before.approval_by);
  check("D1: all protected columns unchanged",
    row.decision === before.decision && row.capability_id === before.capability_id &&
    row.success === before.success && row.workspace_id === before.workspace_id &&
    row.actor_kind === before.actor_kind && String(row.occurred_at) === String(before.occurred_at));

  const delApprover = await tryQ(c, `delete from public.profiles where id='${U.del2}'`);
  check("C2: deleting profile referenced by approval_by SUCCEEDS", delApprover.ok, delApprover.error?.message);
  row = (await c.query(`select * from public.jarvis_action_events where event_id='${EID}'`)).rows[0];
  check("D2: approval_by is now NULL, decision still intact", row.approval_by === null && row.decision === before.decision);

  const delClient = await tryQ(c, `delete from public.clients where id='${CL}'`);
  check("C3: deleting client referenced by target_client_id SUCCEEDS", delClient.ok, delClient.error?.message);
  row = (await c.query(`select * from public.jarvis_action_events where event_id='${EID}'`)).rows[0];
  check("D3: target_client_id is now NULL", row.target_client_id === null);

  const delProposal = await tryQ(c, `delete from public.jarvis_proposals where id='${PID}'`);
  check("C4: deleting referenced proposal SUCCEEDS", delProposal.ok, delProposal.error?.message);
  row = (await c.query(`select * from public.jarvis_action_events where event_id='${EID}'`)).rows[0];
  check("D4: proposal_id is now NULL; success/decision still intact",
    row.proposal_id === null && row.success === true && row.decision === "allow");

  // The event row itself was never deleted through any of this.
  check("audit row still present (never deleted)", (await scalar(c, `select count(*)::int from public.jarvis_action_events where event_id='${EID}'`)) === 1);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0063 JARVIS FK CARVE-OUT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
