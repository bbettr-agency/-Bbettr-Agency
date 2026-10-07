import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static security invariants for the Milestone A read-tool layer. CI gates: every read
 * tool must operate on the INJECTED RLS client (rc.supabase) — never the service-role /
 * admin client, never its own createClient — and must issue no raw SQL. This guarantees
 * the agentic read surface cannot escalate past the authenticated principal's RLS.
 */
const DIR = dirname(fileURLToPath(import.meta.url)); // src/lib/jarvis/retrieval/tools

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}
const files = sources(DIR);

describe("retrieval/tools/** security invariants", () => {
  it("covers the tool source files", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it("NEVER imports the service-role / admin client and NEVER constructs its own client", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/supabase\/admin|createAdminClient|SERVICE_ROLE/);
      // Tools must use the injected rc.supabase, not import the server client factory.
      expect(src).not.toMatch(/@\/lib\/supabase\/server/);
    }
  });

  it("the data-access tools read through rc.supabase (the RLS principal)", () => {
    const dataTools = files.filter((f) => /portal-(agency|client)\.ts$/.test(f));
    expect(dataTools.length).toBe(2);
    for (const f of dataTools) expect(readFileSync(f, "utf8")).toMatch(/rc\.supabase\.from\(/);
  });

  it("issues no raw SQL", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/\.rpc\(\s*["'`]sql["'`]/);
      expect(src).not.toMatch(/execute_sql|raw\s*\(/);
    }
  });
});
