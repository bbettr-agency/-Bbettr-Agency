/**
 * Bbettr OS — Migration 0059 (internal_notification_type += prospect_intake_submitted) proof.
 *
 * Recreates the 0008 enum on a disposable local PostgreSQL, applies the REAL
 * 0059, and proves: the new value exists; every pre-existing value is retained;
 * exactly one value was added; and re-applying is a no-op (IF NOT EXISTS).
 *
 * ⚠️ DESTRUCTIVE on the public schema. Disposable "*test*" DB only.
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
  if (!(/test/i.test(dbName) || /test/i.test(url))) throw new Error("tasks-0059: target DB name must contain 'test'.");
}

const BASE_ENUM = `
create type public.internal_notification_type as enum (
  'deal_submitted','invoice_request','rep_created','rep_deactivated','maintenance_toggled',
  'invoice_approved','invoice_rejected','commission_recorded','deal_status','admin_comment'
);`;

let pass = 0, fail = 0;
function check(name, ok) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); ok ? pass++ : fail++; }
async function labels(c) {
  const { rows } = await c.query(
    `select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='internal_notification_type' order by e.enumsortorder`);
  return rows.map((r) => r.enumlabel);
}

async function main() {
  assertDisposableTarget();
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/planner_test" });
  await c.connect();
  await c.query(`drop schema if exists public cascade; create schema public;`);
  await c.query(BASE_ENUM);
  const before = await labels(c);

  await c.query(readFileSync(join(MIG, "0059_prospect_intake_notification_type.sql"), "utf8"));
  const after = await labels(c);

  check("new value 'prospect_intake_submitted' present", after.includes("prospect_intake_submitted"));
  check("all pre-existing values retained", before.every((v) => after.includes(v)));
  check("exactly one value added", after.length === before.length + 1);

  // Idempotent re-apply (IF NOT EXISTS) — no error, no duplicate.
  let reapplyOk = true;
  try { await c.query(readFileSync(join(MIG, "0059_prospect_intake_notification_type.sql"), "utf8")); }
  catch { reapplyOk = false; }
  check("re-applying 0059 is a safe no-op", reapplyOk && (await labels(c)).length === after.length);

  await c.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} 0059 PROSPECT-INTAKE-NOTIFICATION-TYPE CHECKS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
