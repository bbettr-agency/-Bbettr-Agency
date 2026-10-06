import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static security invariants for the Retrieval V2 layer. These are CI gates, not
 * behavioural tests: the whole retrieval tree must read under the caller's RLS
 * identity only — never the service-role client — and must never issue raw SQL.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url))); // src/lib/jarvis/retrieval

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const files = walk(ROOT);

describe("retrieval/** security invariants", () => {
  it("covers a non-trivial set of source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("NEVER imports or uses the service-role / admin Supabase client", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/supabase\/admin|createAdminClient/.test(src)) offenders.push(f.replace(ROOT, "retrieval"));
    }
    expect(offenders).toEqual([]);
  });

  it("reads only through the RLS server client (createClient from @/lib/supabase/server)", () => {
    // The only module that constructs a Supabase client is the pipeline (via createClient).
    const importsServerClient = files.filter((f) => /@\/lib\/supabase\/server/.test(readFileSync(f, "utf8")));
    expect(importsServerClient.length).toBeGreaterThan(0);
    for (const f of importsServerClient) {
      expect(readFileSync(f, "utf8")).toMatch(/createClient/);
    }
  });

  it("issues no raw SQL (no .rpc('sql'), no execute/query of arbitrary strings)", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/\.rpc\(\s*["'`]sql["'`]/);
      expect(src).not.toMatch(/execute_sql|raw\s*\(/);
    }
  });
});
