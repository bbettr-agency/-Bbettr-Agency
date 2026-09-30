/**
 * Bbettr OS — Migration 0070 (meeting_invitations) proof.
 *
 * Runs the REAL 0070_meeting_invitations.sql on a minimal scaffold (roles, auth,
 * set_updated_at, a minimal meetings table for the FK) against a disposable local
 * PostgreSQL and verifies the invitation-delivery ledger:
 *   - structure: table, RLS enabled+forced, NO policies, updated_at trigger,
 *     method/status CHECKs, non-negative sequence, UNIQUE(meeting,email,seq,method),
 *     meeting_id FK ON DELETE CASCADE, the two indexes
 *   - grants: service_role has table privileges; anon/authenticated fully revoked
 *   - behaviour: service_role can insert/select/update; a normal authenticated
 *     session (even admin) sees zero rows and cannot insert (RLS + no grant);
 *     the UNIQUE key rejects a duplicate logical invitation; FK cascade removes
 *     ledger rows when the meeting is deleted
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");

const M1 = "00000000-0000-0000-0000-0000000000f1";
const M2 = "00000000-0000-0000-0000-0000000000f2";
const ADMIN = "00000000-0000-0000-0000-0000000000a1";

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("meetings-0070: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("meetings-0070: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
grant usage on schema auth, public to anon, authenticated, service_role;
create or replace function public.set_updated_at() returns trigger language plpgsql as $fn$
  begin new.updated_at = now(); return new; end; $fn$;
create table public.profiles (id uuid primary key);
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  updated_at timestamptz not null default now());
grant select, insert, update, delete on public.meetings to service_role;
insert into public.meetings (id) values ('${M1}'), ('${M2}');
`;

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function asRole(c, role, uid, fn) {
  await c.query("begin");
  try {
    await c.query(`set local role ${role}`);
    if (uid) await c.query(`select set_config('request.jwt.claims', json_build_object('sub','${uid}')::text, true)`);
    return await fn();
  } finally {
    await c.query("rollback");
  }
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({
    connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test",
  });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  await c.query(sqlFile("0070_meeting_invitations.sql"));

  // ── Structure ─────────────────────────────────────────────────────────────
  const rls = (await c.query(
    `select relrowsecurity, relforcerowsecurity from pg_class where oid='public.meeting_invitations'::regclass`
  )).rows[0];
  check("RLS enabled", rls.relrowsecurity === true);
  check("RLS forced", rls.relforcerowsecurity === true);

  const nPol = (await c.query(
    `select count(*)::int n from pg_policy where polrelid='public.meeting_invitations'::regclass`
  )).rows[0].n;
  check("no policies (service-role only)", nPol === 0, `found ${nPol}`);

  const trg = (await c.query(
    `select count(*)::int n from pg_trigger where tgrelid='public.meeting_invitations'::regclass and not tgisinternal`
  )).rows[0].n;
  check("updated_at trigger present", trg === 1, `found ${trg}`);

  const cons = (await c.query(
    `select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.meeting_invitations'::regclass`
  )).rows.map((r) => r.d).join(" | ");
  check("UNIQUE(meeting_id,attendee_email,sequence,method)", /UNIQUE \(meeting_id, attendee_email, sequence, method\)/.test(cons));
  check("method CHECK", /method = ANY/.test(cons) || /method IN/i.test(cons));
  check("status CHECK", /status = ANY/.test(cons) || /status IN/i.test(cons));
  check("sequence >= 0 CHECK", /sequence >= 0/.test(cons));
  check("meeting_id FK ON DELETE CASCADE", /FOREIGN KEY \(meeting_id\) REFERENCES meetings\(id\) ON DELETE CASCADE/.test(cons));

  const idx = (await c.query(`select indexname from pg_indexes where tablename='meeting_invitations'`)).rows.map((r) => r.indexname);
  check("meeting index", idx.includes("meeting_invitations_meeting_idx"));
  check("resend message id partial unique index", idx.includes("meeting_invitations_resend_msg_idx"));

  // ── Grants ────────────────────────────────────────────────────────────────
  const grants = (await c.query(
    `select grantee, privilege_type from information_schema.role_table_grants
     where table_name='meeting_invitations' and grantee in ('anon','authenticated','service_role')`
  )).rows;
  check("service_role has privileges", grants.some((g) => g.grantee === "service_role"));
  check("anon revoked", !grants.some((g) => g.grantee === "anon"));
  check("authenticated revoked", !grants.some((g) => g.grantee === "authenticated"));

  // ── Behaviour ─────────────────────────────────────────────────────────────
  // service_role inserts + reads.
  await asRole(c, "service_role", null, async () => {
    await c.query(
      `insert into public.meeting_invitations (meeting_id, attendee_email, method, sequence, ics_uid, content_signature)
       values ('${M1}','a@x.com','request',0,'${M1}@portal.bbettragency.com','sigA')`
    );
    const n = (await c.query(`select count(*)::int n from public.meeting_invitations`)).rows[0].n;
    check("service_role inserts + reads", n === 1, `n=${n}`);
    // duplicate logical invitation rejected
    let dup = false;
    try {
      await c.query(
        `insert into public.meeting_invitations (meeting_id, attendee_email, method, sequence, ics_uid, content_signature)
         values ('${M1}','a@x.com','request',0,'${M1}@portal.bbettragency.com','sigA')`
      );
    } catch {
      dup = true;
    }
    check("UNIQUE rejects a duplicate (meeting,email,seq,method)", dup);
  });

  // Persist one row (outside a rolled-back tx) for the RLS + cascade checks.
  await c.query(
    `insert into public.meeting_invitations (meeting_id, attendee_email, method, sequence, ics_uid, content_signature)
     values ('${M2}','b@y.com','request',0,'${M2}@portal.bbettragency.com','sigB')`
  );

  // authenticated admin sees zero + cannot insert (RLS force + no grant).
  await c.query(`insert into public.profiles (id) values ('${ADMIN}') on conflict do nothing`);
  await asRole(c, "authenticated", ADMIN, async () => {
    let seen = -1;
    try {
      seen = (await c.query(`select count(*)::int n from public.meeting_invitations`)).rows[0].n;
    } catch {
      seen = "denied";
    }
    check("authenticated sees zero rows (or is denied)", seen === 0 || seen === "denied", `seen=${seen}`);
    let blocked = false;
    try {
      await c.query(
        `insert into public.meeting_invitations (meeting_id, attendee_email, method, sequence, ics_uid, content_signature)
         values ('${M2}','c@z.com','request',0,'x','y')`
      );
    } catch {
      blocked = true;
    }
    check("authenticated insert blocked", blocked);
  });

  // FK cascade: deleting the meeting removes its ledger rows.
  await c.query(`delete from public.meetings where id='${M2}'`);
  const remaining = (await c.query(`select count(*)::int n from public.meeting_invitations where meeting_id='${M2}'`)).rows[0].n;
  check("FK cascade clears ledger on meeting delete", remaining === 0, `remaining=${remaining}`);

  await c.end();
  console.log(`\n${failed === 0 ? "✅ meeting_invitations (0070): all checks passed" : `❌ ${failed} check(s) FAILED`}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
