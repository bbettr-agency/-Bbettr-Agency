import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest config for pure-logic + fake-provider unit tests (Phase 3).
 *
 * This is the development-only unit-test substrate. It is SEPARATE from the
 * real-Postgres RLS proof (supabase/tests/planner-rls.test.mjs, run via
 * `npm run test:rls`), which remains the database-security gate.
 *
 * `server-only` is aliased to an empty stub so server-tagged modules can be
 * imported in the Node test environment without throwing.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
  },
});
