import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The privileged generator endpoint must be reachable ONLY by a trusted scheduler
// holding the bearer secret — never a browser/user session.
vi.mock("@/lib/flags", () => ({ isPlannerEnabled: vi.fn(), isTasksEnabled: vi.fn() }));
vi.mock("@/lib/planner/recurrence/generator", () => ({ generateDueRecurrences: vi.fn() }));

import { POST } from "@/app/api/planner/recurrences/generate/route";
import { isPlannerEnabled, isTasksEnabled } from "@/lib/flags";
import { generateDueRecurrences } from "@/lib/planner/recurrence/generator";

const SECRET = "s3cr3t-cron-token";
const req = (auth?: string) =>
  new Request("https://x/api/planner/recurrences/generate", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  vi.mocked(isPlannerEnabled).mockReturnValue(true);
  vi.mocked(isTasksEnabled).mockReturnValue(true);
  vi.mocked(generateDueRecurrences).mockReset();
  vi.mocked(generateDueRecurrences).mockResolvedValue({
    definitionsProcessed: 2, occurrencesCreated: 1, occurrencesExisting: 1, skipped: 0, advanced: 1, errors: 0,
  });
  process.env.PLANNER_CRON_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.PLANNER_CRON_SECRET;
});

describe("POST /api/planner/recurrences/generate", () => {
  it("404s when the Planner or Tasks flag is off (never runs the generator)", async () => {
    vi.mocked(isTasksEnabled).mockReturnValue(false);
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(404);
    expect(generateDueRecurrences).not.toHaveBeenCalled();
  });

  it("503s when no secret is configured (endpoint disabled, never open)", async () => {
    delete process.env.PLANNER_CRON_SECRET;
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(generateDueRecurrences).not.toHaveBeenCalled();
  });

  it("401s on a missing bearer token", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(generateDueRecurrences).not.toHaveBeenCalled();
  });

  it("401s on a WRONG bearer token", async () => {
    const res = await POST(req("Bearer nope"));
    expect(res.status).toBe(401);
    expect(generateDueRecurrences).not.toHaveBeenCalled();
  });

  it("runs the generator only with the correct bearer secret", async () => {
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(generateDueRecurrences).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.summary.occurrencesCreated).toBe(1);
  });
});
