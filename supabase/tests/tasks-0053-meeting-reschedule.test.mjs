/**
 * Bbettr OS — Migration 0053 (meeting no-show + secure self-service reschedule) proof.
 *
 * Runs the REAL 0053 on top of the meetings chain (0029–0034) against a
 * disposable local PostgreSQL and verifies:
 *   - the FOUR additive columns (types, nullability) and the SHA-256 hex length CHECK;
 *   - the partial UNIQUE index on non-null token hashes (many NULLs coexist, dup hash rejected);
 *   - NO status-enum change ('no_show' still rejected), NO new meetings columns beyond +4,
 *     RLS still enabled+forced with exactly the 3 original policies;
 *   - confirm_meeting_reschedule: SECURITY INVOKER, EXECUTE granted to service_role ONLY
 *     (anon/authenticated denied);
 *   - confirm behaviour:
 *       • valid token → reschedules, CLEARS no_show_at, CONSUMES token,
 *         PRESERVES no_show_followup_sent_at;
 *       • a NO-SHOW meeting (no_show_at IS NOT NULL) is a VALID target (the locked lifecycle);
 *       • expired / cancelled / soft-deleted / already-consumed token → reschedule_link_invalid;
 *       • ends<=starts → invalid_slot;
 *       • Portal double-book guard → slot_taken; excludes self and cancelled/deleted others;
 *   - the meetings column count grows by EXACTLY 4 across 0053, and the full chain composes.
 *
 * ⚠️ DESTRUCTIVE: drops/recreates public+auth. Disposable "*test*" DB only.
 */
import pg from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = process.env.PLANNER_MIG_DIR || join(HERE, "..", "migrations");
const CLIENT_ROW = "00000000-0000-0000-0000-0000000000b1";
const U = {
  admin1: "00000000-0000-0000-0000-0000000000a1",
  client: "00000000-0000-0000-0000-0000000000c1",
  rep: "00000000-0000-0000-0000-0000000000d1",
};

function assertDisposableTarget() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = (url.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "";
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0053: target DB name must contain 'test'.");
  const looksLocal = /localhost|127\.0\.0\.1/.test(url) || url.includes("host=/") || /@\//.test(url);
  if (!looksLocal && process.env.PLANNER_RLS_ALLOW_REMOTE !== "1")
    throw new Error("tasks-0053: refusing non-local host without PLANNER_RLS_ALLOW_REMOTE=1.");
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
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
do $$ begin if not exists (select 1 from pg_type where typname='user_role') then
  create type public.user_role as enum ('admin','client','rep'); end if; end $$;
create table public.clients (id uuid primary key default gen_random_uuid());
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  client_id uuid references public.clients(id) on delete set null,
  full_name text, email text, avatar_url text, created_at timestamptz not null default now());
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path=public stable as $fn$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin'); $fn$;
grant select on public.profiles to authenticated;
insert into auth.users (id,email) values ('${U.admin1}','a1'),('${U.client}','c1'),('${U.rep}','d1');
insert into public.clients (id) values ('${CLIENT_ROW}');
insert into public.profiles (id,role,full_name) values
  ('${U.admin1}','admin','Eloff'),('${U.client}','client','Client'),('${U.rep}','rep','Rep');
`;

const MEETINGS_CHAIN = [
  "0029_meetings.sql", "0030_meeting_attendees.sql", "0031_calendar_projections.sql",
  "0032_meetings_idempotency.sql", "0033_create_meeting_rpc.sql", "0034_soft_delete_meeting.sql",
];
const MIG_0053 = "0053_meeting_no_show_reschedule.sql";

const sqlFile = (f) => readFileSync(join(MIG, f), "utf8");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); ok ? pass++ : fail++; }
async function tryQuery(c, text, params = []) {
  try { const r = await c.query(text, params); return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null }; }
  catch (e) { return { rows: [], rowCount: 0, error: e }; }
}
async function scalar(c, text, params = []) { const { rows } = await c.query(text, params); return rows[0] ? Object.values(rows[0])[0] : undefined; }

/** Insert a meeting (audit trigger stamps created_by from auth.uid()). Extra cols passed through. */
async function insMeeting(c, over = {}) {
  const base = { title: "M", starts_at: "2026-09-01T09:00:00Z", ends_at: "2026-09-01T10:00:00Z" };
  const merged = { ...base, ...over };
  const keys = Object.keys(merged);
  return tryQuery(c,
    `insert into public.meetings (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((k) => merged[k]));
}
async function confirm(c, hash, s, e) {
  return tryQuery(c, `select public.confirm_meeting_reschedule($1,$2,$3) as id`, [hash, s, e]);
}
async function meetingRow(c, id) {
  return (await c.query(`select * from public.meetings where id=$1`, [id])).rows[0];
}

async function setup(c) {
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  for (const f of MEETINGS_CHAIN) await c.query(sqlFile(f));
  await c.query(sqlFile(MIG_0053));
  // Act as admin so the audit trigger's auth.uid() resolves on inserts.
  await c.query(`select set_config('request.jwt.claims', json_build_object('sub','${U.admin1}')::text, false)`);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await setup(c);

  const HEX64 = sha256("raw-token-A");
  const future = "now() + interval '14 days'";
  const past = "now() - interval '1 minute'";

  // ── Added columns ──────────────────────────────────────────────────────────
  console.log("\n── added columns ──");
  const cols = (await c.query(`select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='meetings' and column_name = any($1)`,
    [["no_show_at", "no_show_followup_sent_at", "reschedule_token_hash", "reschedule_token_expires_at"]])).rows;
  const byName = Object.fromEntries(cols.map((r) => [r.column_name, r]));
  check("no_show_at: timestamptz, nullable", byName.no_show_at?.data_type === "timestamp with time zone" && byName.no_show_at?.is_nullable === "YES");
  check("no_show_followup_sent_at: timestamptz, nullable", byName.no_show_followup_sent_at?.data_type === "timestamp with time zone" && byName.no_show_followup_sent_at?.is_nullable === "YES");
  check("reschedule_token_hash: text, nullable", byName.reschedule_token_hash?.data_type === "text" && byName.reschedule_token_hash?.is_nullable === "YES");
  check("reschedule_token_expires_at: timestamptz, nullable", byName.reschedule_token_expires_at?.data_type === "timestamp with time zone" && byName.reschedule_token_expires_at?.is_nullable === "YES");

  // ── Hash length CHECK ──────────────────────────────────────────────────────
  console.log("\n── reschedule_token_hash length CHECK ──");
  check("null hash accepted", (await insMeeting(c, { reschedule_token_hash: null })).error === null);
  check("64-char hex hash accepted", (await insMeeting(c, { reschedule_token_hash: sha256("unique-1") })).error === null);
  check("10-char hash rejected", (await insMeeting(c, { reschedule_token_hash: "0123456789" })).error !== null);
  check("65-char hash rejected", (await insMeeting(c, { reschedule_token_hash: "a".repeat(65) })).error !== null);

  // ── Partial unique index ───────────────────────────────────────────────────
  console.log("\n── partial unique index on non-null hashes ──");
  const idxdef = await scalar(c, `select indexdef from pg_indexes where schemaname='public' and indexname='meetings_reschedule_token_hash_key'`);
  check("index exists, UNIQUE, partial on NOT NULL", typeof idxdef === "string" && /UNIQUE/i.test(idxdef) && /reschedule_token_hash IS NOT NULL/i.test(idxdef), idxdef ?? "missing");
  check("two NULL hashes coexist", (await insMeeting(c, { reschedule_token_hash: null })).error === null && (await insMeeting(c, { reschedule_token_hash: null })).error === null);
  const dupHash = sha256("dup");
  check("first insert of a hash ok", (await insMeeting(c, { reschedule_token_hash: dupHash })).error === null);
  check("duplicate non-null hash rejected", (await insMeeting(c, { reschedule_token_hash: dupHash })).error !== null);

  // ── No status-enum change ──────────────────────────────────────────────────
  console.log("\n── status vocabulary unchanged ──");
  check("status='no_show' rejected (no widening)", (await insMeeting(c, { status: "no_show" })).error !== null);
  // Target the status-vocabulary CHECK specifically (meetings_cancel_consistency also references status).
  const statusDef = await scalar(c, `select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.meetings'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%status = any%'`);
  check("status CHECK still exactly scheduled|cancelled", /'scheduled'::text/.test(statusDef ?? "") && /'cancelled'::text/.test(statusDef ?? "") && !/no_show/.test(statusDef ?? ""), statusDef ?? "not found");

  // ── RLS / policies unchanged ───────────────────────────────────────────────
  console.log("\n── RLS + policies unchanged ──");
  check("RLS still enabled + forced", (await scalar(c, `select relrowsecurity and relforcerowsecurity from pg_class where oid='public.meetings'::regclass`)) === true);
  check("exactly 3 policies (select/insert/update)", (await scalar(c, `select count(*)::int from pg_policies where schemaname='public' and tablename='meetings'`)) === 3);
  check("no anon grant on meetings", (await scalar(c, `select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name='meetings' and grantee='anon'`)) === 0);

  // ── Function metadata ──────────────────────────────────────────────────────
  console.log("\n── confirm_meeting_reschedule metadata ──");
  const fnsig = "public.confirm_meeting_reschedule(text, timestamptz, timestamptz)";
  check("function exists", (await scalar(c, `select count(*)::int from pg_proc where proname='confirm_meeting_reschedule'`)) === 1);
  check("SECURITY INVOKER (prosecdef=false)", (await scalar(c, `select prosecdef from pg_proc where proname='confirm_meeting_reschedule'`)) === false);
  check("service_role has EXECUTE", (await scalar(c, `select has_function_privilege('service_role', '${fnsig}', 'EXECUTE')`)) === true);
  check("anon DENIED EXECUTE", (await scalar(c, `select has_function_privilege('anon', '${fnsig}', 'EXECUTE')`)) === false);
  check("authenticated DENIED EXECUTE", (await scalar(c, `select has_function_privilege('authenticated', '${fnsig}', 'EXECUTE')`)) === false);

  // ── Behaviour: valid no-show reschedule (the locked lifecycle) ─────────────
  console.log("\n── confirm: valid no-show reschedule ──");
  const m1 = await scalar(c, `insert into public.meetings (title, starts_at, ends_at, no_show_at, no_show_followup_sent_at, reschedule_token_hash, reschedule_token_expires_at)
    values ('No-show', '2026-09-10T09:00:00Z', '2026-09-10T10:00:00Z', now(), now(), '${HEX64}', ${future}) returning id`);
  const r1 = await confirm(c, HEX64, "2026-09-20T14:00:00Z", "2026-09-20T15:00:00Z");
  check("no-show meeting IS a valid target → returns its id", r1.error === null && r1.rows[0].id === m1, r1.error?.message ?? "");
  const row1 = await meetingRow(c, m1);
  check("starts_at updated", new Date(row1.starts_at).toISOString() === "2026-09-20T14:00:00.000Z");
  check("ends_at updated", new Date(row1.ends_at).toISOString() === "2026-09-20T15:00:00.000Z");
  check("no_show_at CLEARED", row1.no_show_at === null);
  check("token CONSUMED (hash null, expires null)", row1.reschedule_token_hash === null && row1.reschedule_token_expires_at === null);
  check("no_show_followup_sent_at PRESERVED", row1.no_show_followup_sent_at !== null);

  // ── Behaviour: already-consumed token ──────────────────────────────────────
  console.log("\n── confirm: consumed token ──");
  const rReuse = await confirm(c, HEX64, "2026-09-21T14:00:00Z", "2026-09-21T15:00:00Z");
  check("re-using a consumed token → reschedule_link_invalid", /reschedule_link_invalid/.test(rReuse.error?.message ?? ""), rReuse.error?.message ?? "no error");

  // ── Behaviour: expired / cancelled / deleted ───────────────────────────────
  console.log("\n── confirm: expired / cancelled / deleted rejected ──");
  const hExp = sha256("expired");
  await c.query(`insert into public.meetings (title, starts_at, ends_at, reschedule_token_hash, reschedule_token_expires_at)
    values ('Exp','2026-09-10T09:00:00Z','2026-09-10T10:00:00Z','${hExp}', ${past})`);
  check("expired token → invalid", /reschedule_link_invalid/.test((await confirm(c, hExp, "2026-09-22T09:00:00Z", "2026-09-22T10:00:00Z")).error?.message ?? ""));

  const hCanc = sha256("cancelled");
  const mCanc = await scalar(c, `insert into public.meetings (title, starts_at, ends_at, status, reschedule_token_hash, reschedule_token_expires_at)
    values ('Canc','2026-09-10T09:00:00Z','2026-09-10T10:00:00Z','cancelled','${hCanc}', ${future}) returning id`);
  check("cancelled meeting → invalid", /reschedule_link_invalid/.test((await confirm(c, hCanc, "2026-09-23T09:00:00Z", "2026-09-23T10:00:00Z")).error?.message ?? ""));
  check("cancelled meeting untouched by failed confirm", (await meetingRow(c, mCanc)).reschedule_token_hash === hCanc);

  const hDel = sha256("deleted");
  await c.query(`insert into public.meetings (title, starts_at, ends_at, deleted_at, reschedule_token_hash, reschedule_token_expires_at)
    values ('Del','2026-09-10T09:00:00Z','2026-09-10T10:00:00Z', now(), '${hDel}', ${future})`);
  check("soft-deleted meeting → invalid", /reschedule_link_invalid/.test((await confirm(c, hDel, "2026-09-24T09:00:00Z", "2026-09-24T10:00:00Z")).error?.message ?? ""));

  // ── Behaviour: invalid slot ────────────────────────────────────────────────
  console.log("\n── confirm: invalid slot ──");
  const hSlot = sha256("slotcheck");
  await c.query(`insert into public.meetings (title, starts_at, ends_at, reschedule_token_hash, reschedule_token_expires_at)
    values ('Slot','2026-09-10T09:00:00Z','2026-09-10T10:00:00Z','${hSlot}', ${future})`);
  check("ends<=starts → invalid_slot", /invalid_slot/.test((await confirm(c, hSlot, "2026-09-25T10:00:00Z", "2026-09-25T10:00:00Z")).error?.message ?? ""));

  // ── Behaviour: Portal double-book guard ────────────────────────────────────
  console.log("\n── confirm: Portal double-book guard ──");
  const hMove = sha256("mover");
  const mMove = await scalar(c, `insert into public.meetings (title, starts_at, ends_at, reschedule_token_hash, reschedule_token_expires_at)
    values ('Mover','2026-10-01T09:00:00Z','2026-10-01T10:00:00Z','${hMove}', ${future}) returning id`);
  // Another ACTIVE meeting occupies 2026-10-05 11:00–12:00.
  await c.query(`insert into public.meetings (title, starts_at, ends_at) values ('Busy','2026-10-05T11:00:00Z','2026-10-05T12:00:00Z')`);
  check("overlapping an active meeting → slot_taken", /slot_taken/.test((await confirm(c, hMove, "2026-10-05T11:30:00Z", "2026-10-05T12:30:00Z")).error?.message ?? ""));
  check("token NOT consumed after slot_taken", (await meetingRow(c, mMove)).reschedule_token_hash === hMove);
  // A CANCELLED meeting occupying 2026-10-06 09:00–10:00 must NOT block.
  await c.query(`insert into public.meetings (title, starts_at, ends_at, status) values ('BusyCanc','2026-10-06T09:00:00Z','2026-10-06T10:00:00Z','cancelled')`);
  const rFree = await confirm(c, hMove, "2026-10-06T09:00:00Z", "2026-10-06T10:00:00Z");
  check("cancelled meeting does NOT block the slot → success", rFree.error === null && rFree.rows[0].id === mMove, rFree.error?.message ?? "");

  // ── Column count grows by EXACTLY 4 ────────────────────────────────────────
  console.log("\n── column delta + chain composition ──");
  await c.query(`drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;`);
  await c.query(SCAFFOLD);
  let chainErr = null;
  try { for (const f of MEETINGS_CHAIN) await c.query(sqlFile(f)); } catch (e) { chainErr = e; }
  const before = await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='meetings'`);
  let apply53Err = null;
  try { await c.query(sqlFile(MIG_0053)); } catch (e) { apply53Err = e; }
  const after = await scalar(c, `select count(*)::int from information_schema.columns where table_schema='public' and table_name='meetings'`);
  check("meetings chain 0029–0034 applies cleanly", chainErr === null, chainErr?.message ?? "");
  check("0053 applies cleanly on the chain", apply53Err === null, apply53Err?.message ?? "");
  check("meetings column count grew by exactly 4", after - before === 4, `before=${before} after=${after}`);

  console.log(`\n${fail === 0 ? "✅" : "❌"} 0053 MEETING-RESCHEDULE CHECKS: ${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
