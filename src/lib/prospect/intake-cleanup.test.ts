import { describe, it, expect, vi } from "vitest";
import {
  authorizeCleanup,
  isStaleDraft,
  runCleanup,
  type CleanupStore,
} from "./intake-cleanup";

const NOW = new Date("2026-09-08T12:00:00Z");
const PAST = "2026-09-01T00:00:00Z"; // before NOW
const FUTURE = "2099-01-01T00:00:00Z"; // after NOW

describe("authorizeCleanup — fail closed", () => {
  it("no secret configured → 503 (disabled, never open)", () => {
    expect(authorizeCleanup("Bearer whatever", undefined)).toEqual({ ok: false, status: 503 });
    expect(authorizeCleanup("Bearer whatever", "")).toEqual({ ok: false, status: 503 });
  });
  it("wrong or missing bearer → 401", () => {
    expect(authorizeCleanup(null, "s3cret")).toEqual({ ok: false, status: 401 });
    expect(authorizeCleanup("Bearer nope", "s3cret")).toEqual({ ok: false, status: 401 });
    expect(authorizeCleanup("s3cret", "s3cret")).toEqual({ ok: false, status: 401 }); // missing "Bearer "
  });
  it("correct bearer → ok/200", () => {
    expect(authorizeCleanup("Bearer s3cret", "s3cret")).toEqual({ ok: true, status: 200 });
  });
});

describe("isStaleDraft — eligibility (status='draft' AND expired)", () => {
  it("expired draft → true", () => {
    expect(isStaleDraft({ status: "draft", token_expires_at: PAST }, NOW)).toBe(true);
  });
  it("non-expired draft → false", () => {
    expect(isStaleDraft({ status: "draft", token_expires_at: FUTURE }, NOW)).toBe(false);
  });
  it("expired but submitted / converted / dismissed → false (never deleted)", () => {
    for (const status of ["submitted", "converted", "dismissed"]) {
      expect(isStaleDraft({ status, token_expires_at: PAST }, NOW)).toBe(false);
    }
  });
  it("unparseable / missing expiry → false (fail safe, do not delete)", () => {
    expect(isStaleDraft({ status: "draft", token_expires_at: "not-a-date" }, NOW)).toBe(false);
    expect(isStaleDraft(null, NOW)).toBe(false);
  });
});

// ── Fake store faithfully modelling the eligibility predicate + delete guard ──
interface Row {
  id: string;
  status: string;
  token_expires_at: string;
}
function makeStore(rows: Row[]) {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  const eligible = (r: Row | undefined, nowIso: string) =>
    !!r && r.status === "draft" && r.token_expires_at < nowIso;
  const findSpy = vi.fn();
  const store: CleanupStore = {
    async findExpiredDraftIds(nowIso, limit) {
      findSpy(nowIso, limit);
      const ids: string[] = [];
      for (const r of byId.values()) {
        if (eligible(r, nowIso)) ids.push(r.id);
        if (ids.length >= limit) break;
      }
      return ids;
    },
    async deleteDraftsByIds(ids, nowIso) {
      let n = 0;
      for (const id of ids) {
        const r = byId.get(id);
        if (eligible(r, nowIso)) {
          // re-assert at the boundary — a row that left 'draft' is NOT deleted
          byId.delete(id);
          n++;
        }
      }
      return n;
    },
  };
  return { store, byId, findSpy };
}

describe("runCleanup — deletes only eligible rows, idempotent, bounded", () => {
  it("deletes expired drafts and preserves everything else", async () => {
    const { store, byId } = makeStore([
      { id: "expired-draft", status: "draft", token_expires_at: PAST },
      { id: "live-draft", status: "draft", token_expires_at: FUTURE },
      { id: "expired-submitted", status: "submitted", token_expires_at: PAST },
      { id: "expired-converted", status: "converted", token_expires_at: PAST },
      { id: "expired-dismissed", status: "dismissed", token_expires_at: PAST },
    ]);
    const res = await runCleanup(store, { now: NOW });
    expect(res.deleted).toBe(1);
    expect(res.done).toBe(true);
    expect(byId.has("expired-draft")).toBe(false); // gone
    expect([...byId.keys()].sort()).toEqual(
      ["expired-converted", "expired-dismissed", "expired-submitted", "live-draft"].sort()
    );
  });

  it("is idempotent — a second run deletes nothing", async () => {
    const { store } = makeStore([{ id: "e", status: "draft", token_expires_at: PAST }]);
    expect((await runCleanup(store, { now: NOW })).deleted).toBe(1);
    const second = await runCleanup(store, { now: NOW });
    expect(second.deleted).toBe(0);
    expect(second.done).toBe(true);
  });

  it("batches through a backlog and reports done when drained", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 12; i++) rows.push({ id: `d${i}`, status: "draft", token_expires_at: PAST });
    const { store, byId, findSpy } = makeStore(rows);
    const res = await runCleanup(store, { now: NOW, batchSize: 5, maxBatches: 10 });
    expect(res.deleted).toBe(12);
    expect(res.done).toBe(true);
    expect(res.batches).toBe(3); // 5 + 5 + 2
    expect(byId.size).toBe(0);
    expect(findSpy.mock.calls.every((c) => c[1] === 5)).toBe(true); // limit honoured
  });

  it("respects the batch cap and reports NOT done (remainder for next tick)", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 30; i++) rows.push({ id: `d${i}`, status: "draft", token_expires_at: PAST });
    const { store, byId } = makeStore(rows);
    const res = await runCleanup(store, { now: NOW, batchSize: 5, maxBatches: 2 });
    expect(res.batches).toBe(2);
    expect(res.deleted).toBe(10); // only 2 batches ran
    expect(res.done).toBe(false); // capped — 20 remain
    expect(byId.size).toBe(20);
  });

  it("nothing eligible → zero deletions, done", async () => {
    const { store } = makeStore([
      { id: "live", status: "draft", token_expires_at: FUTURE },
      { id: "sub", status: "submitted", token_expires_at: PAST },
    ]);
    const res = await runCleanup(store, { now: NOW });
    expect(res).toEqual({ deleted: 0, batches: 0, done: true });
  });

  it("delete guard: a row that leaves 'draft' between find and delete is not counted", async () => {
    const { store, byId } = makeStore([{ id: "x", status: "draft", token_expires_at: PAST }]);
    // Wrap find to flip the row to submitted AFTER it is selected but BEFORE delete.
    const origFind = store.findExpiredDraftIds.bind(store);
    store.findExpiredDraftIds = async (nowIso, limit) => {
      const ids = await origFind(nowIso, limit);
      const r = byId.get("x");
      if (r) r.status = "submitted"; // concurrent submit
      return ids;
    };
    const res = await runCleanup(store, { now: NOW });
    expect(res.deleted).toBe(0); // guard rejected it
    expect(byId.get("x")?.status).toBe("submitted"); // preserved, untouched
  });
});
