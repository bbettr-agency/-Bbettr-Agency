import { describe, it, expect, beforeEach } from "vitest";
import { IntegrationAuthError, IntegrationTimeoutError } from "@/lib/net";
import { projectEntity, reconcilePending, type EngineDeps } from "./reconcile";
import type { SyncLogFields } from "./observability";
import type {
  EntityRef,
  ProjectionPatch,
  ProjectionRecord,
  ProjectionStore,
} from "./store";
import type { DesiredStateProvider } from "./desired-provider";
import type {
  CalendarProvider,
  DesiredDraft,
  DesiredEvent,
  ProviderOutcome,
  ReflectedEvent,
} from "./types";
import type { MeetState } from "@/lib/database.types";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const REF: EntityRef = { entityType: "meeting", entityId: UUID };

function makeDraft(overrides: Partial<DesiredDraft> = {}): DesiredDraft {
  return {
    entityType: "meeting",
    entityId: UUID,
    calendarId: "cal@example.com",
    title: "Kickoff",
    description: null,
    startsAt: "2026-08-01T09:00:00.000Z",
    endsAt: "2026-08-01T10:00:00.000Z",
    timeZone: "Africa/Johannesburg",
    attendees: [],
    wantsMeet: false,
    intent: "active",
    ...overrides,
  };
}

/** In-memory ProjectionStore. */
class InMemoryStore implements ProjectionStore {
  desired = new Map<string, DesiredDraft | null>();
  records = new Map<string, ProjectionRecord>();
  private seq = 0;
  private key(ref: EntityRef) {
    return `${ref.entityType}:${ref.entityId}`;
  }
  setDesired(ref: EntityRef, draft: DesiredDraft | null) {
    this.desired.set(this.key(ref), draft);
  }
  forceLock(ref: EntityRef, lockedAt: string, token: string) {
    const r = this.records.get(this.key(ref));
    if (r) {
      r.lockedAt = lockedAt;
      r.lockToken = token;
    }
  }
  raw(ref: EntityRef) {
    return this.records.get(this.key(ref));
  }
  /** Test-only desired-state lookup, exposed to the fake DesiredStateProvider. */
  peekDesired(ref: EntityRef) {
    return this.desired.get(this.key(ref)) ?? null;
  }
  async loadProjection(ref: EntityRef) {
    const r = this.records.get(this.key(ref));
    return r ? { ...r } : null;
  }
  async ensureProjection(ref: EntityRef, calendarId: string) {
    const k = this.key(ref);
    let r = this.records.get(k);
    if (!r) {
      r = {
        id: `p${++this.seq}`,
        entityType: ref.entityType,
        entityId: ref.entityId,
        googleCalendarId: calendarId,
        googleEventId: null,
        idEpoch: 0,
        etag: null,
        meetUrl: null,
        meetState: "not_requested",
        lastMeetError: null,
        syncState: "pending",
        syncedHash: null,
        syncAttempts: 0,
        nextAttemptAt: null,
        lockedAt: null,
        lockToken: null,
      };
      this.records.set(k, r);
    }
    return { ...r };
  }
  async acquireLock(id: string, token: string, nowIso: string, staleBeforeIso: string) {
    const r = [...this.records.values()].find((x) => x.id === id);
    if (!r) return null;
    if (r.lockedAt && r.lockedAt >= staleBeforeIso) return null; // held & fresh
    r.lockedAt = nowIso;
    r.lockToken = token;
    return { ...r };
  }
  async saveResult(id: string, patch: ProjectionPatch) {
    const r = [...this.records.values()].find((x) => x.id === id);
    if (!r) return;
    const { releaseLock, lastSyncAt, lastSyncError, ...fields } = patch;
    void lastSyncAt;
    void lastSyncError;
    Object.assign(r, fields);
    if (releaseLock && r.lockToken === releaseLock) {
      r.lockedAt = null;
      r.lockToken = null;
    }
  }
  async listDue(limit: number, nowIso: string) {
    return [...this.records.values()]
      .filter(
        (r) =>
          (r.syncState === "pending" || r.syncState === "failed") &&
          (!r.nextAttemptAt || r.nextAttemptAt <= nowIso)
      )
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
}

/** Configurable fake CalendarProvider. */
class FakeProvider implements CalendarProvider {
  behavior: "ok" | "timeout" | "authfail" = "ok";
  meetSequence: MeetState[] = [];
  creates = 0;
  updates = 0;
  deletes = 0;
  reconciles = 0;
  private evId = "ev-fixed";

  async create(): Promise<ReflectedEvent> {
    throw new Error("not used directly");
  }
  async update(): Promise<ReflectedEvent> {
    throw new Error("not used directly");
  }
  async delete(): Promise<void> {}
  async reconcile(
    desired: DesiredEvent,
    current: { googleEventId: string | null; etag: string | null }
  ): Promise<ProviderOutcome> {
    this.reconciles++;
    if (this.behavior === "timeout") throw new IntegrationTimeoutError("google", 8000);
    if (this.behavior === "authfail")
      throw new IntegrationAuthError("google", "authorization no longer valid");
    if (desired.intent !== "active") {
      this.deletes++;
      return { kind: "deleted" };
    }
    if (current.googleEventId) this.updates++;
    else this.creates++;
    const meetState: MeetState = desired.wantsMeet
      ? this.meetSequence.shift() ?? "ready"
      : "not_requested";
    return {
      kind: "projected",
      event: {
        googleEventId: current.googleEventId ?? this.evId,
        etag: `etag-${this.reconciles}`,
        meetUrl: meetState === "ready" ? "https://meet.google.com/x" : null,
        meetState,
        meetError: meetState === "failed" ? "conference_create_failed" : null,
      },
    };
  }
}

let store: InMemoryStore;
let provider: FakeProvider;
let logs: SyncLogFields[];
let clockMs: number;
let tokenSeq: number;

function deps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  const desired: DesiredStateProvider = {
    loadDesired: async (ref) => store.peekDesired(ref),
  };
  return {
    provider,
    store,
    desired,
    log: (f) => logs.push(f),
    now: () => new Date(clockMs),
    newToken: () => `tok-${++tokenSeq}`,
    ...overrides,
  };
}

beforeEach(() => {
  store = new InMemoryStore();
  provider = new FakeProvider();
  logs = [];
  clockMs = new Date("2026-07-30T08:00:00.000Z").getTime();
  tokenSeq = 0;
});

describe("projectEntity — idempotency & duplicate prevention", () => {
  it("creates once, and a replay of unchanged state is a no-op (no duplicate)", async () => {
    store.setDesired(REF, makeDraft());

    const first = await projectEntity(deps(), REF, "cid-1");
    expect(first).toMatchObject({ result: "success", operation: "create" });
    expect(provider.creates).toBe(1);
    expect(store.raw(REF)!.syncState).toBe("synced");
    expect(store.raw(REF)!.googleEventId).toBe("ev-fixed");

    const second = await projectEntity(deps(), REF, "cid-2");
    expect(second).toMatchObject({ result: "skipped", reason: "no_change" });
    expect(provider.creates).toBe(1); // NOT re-created
    expect(provider.reconciles).toBe(1); // provider not even called the 2nd time
  });

  it("an edit projects as an update, never a second create", async () => {
    store.setDesired(REF, makeDraft());
    await projectEntity(deps(), REF, "c1");
    store.setDesired(REF, makeDraft({ title: "Renamed" }));
    const r = await projectEntity(deps(), REF, "c2");
    expect(r).toMatchObject({ result: "success", operation: "update" });
    expect(provider.creates).toBe(1);
    expect(provider.updates).toBe(1);
  });
});

describe("projectEntity — single-flight lock", () => {
  it("skips when another worker holds a fresh lock", async () => {
    store.setDesired(REF, makeDraft());
    await store.ensureProjection(REF, "cal@example.com");
    store.forceLock(REF, new Date(clockMs).toISOString(), "other-worker");

    const r = await projectEntity(deps(), REF, "c1");
    expect(r).toMatchObject({ result: "skipped", reason: "locked" });
    expect(provider.reconciles).toBe(0);
  });

  it("reclaims a stale lock and proceeds", async () => {
    store.setDesired(REF, makeDraft());
    await store.ensureProjection(REF, "cal@example.com");
    const stale = new Date(clockMs - 10 * 60 * 1000).toISOString(); // 10 min ago
    store.forceLock(REF, stale, "dead-worker");

    const r = await projectEntity(deps(), REF, "c1");
    expect(r.result).toBe("success");
    expect(provider.reconciles).toBe(1);
    expect(store.raw(REF)!.lockedAt).toBeNull(); // released after success
  });
});

describe("projectEntity — failure handling", () => {
  it("a timeout leaves the row failed and retryable with backoff", async () => {
    store.setDesired(REF, makeDraft());
    provider.behavior = "timeout";
    const r = await projectEntity(deps(), REF, "c1");
    expect(r).toMatchObject({ result: "failure", reason: "timeout", disconnected: false });
    const rec = store.raw(REF)!;
    expect(rec.syncState).toBe("failed");
    expect(rec.syncAttempts).toBe(1);
    expect(rec.nextAttemptAt).not.toBeNull();
    expect(rec.lockedAt).toBeNull();
  });

  it("an auth failure marks the projection disconnected with no next attempt", async () => {
    store.setDesired(REF, makeDraft());
    provider.behavior = "authfail";
    const r = await projectEntity(deps(), REF, "c1");
    expect(r).toMatchObject({ result: "failure", disconnected: true });
    const rec = store.raw(REF)!;
    expect(rec.syncState).toBe("disconnected");
    expect(rec.nextAttemptAt).toBeNull();
  });
});

describe("projectEntity — explicit Meet state", () => {
  it("stays synced-but-pending, then promotes to ready on a later pass", async () => {
    store.setDesired(REF, makeDraft({ wantsMeet: true }));
    provider.meetSequence = ["pending", "ready"];

    const first = await projectEntity(deps(), REF, "c1");
    expect(first).toMatchObject({ result: "success", meetPending: true });
    let rec = store.raw(REF)!;
    expect(rec.syncState).toBe("synced");
    expect(rec.meetState).toBe("pending");
    expect(rec.nextAttemptAt).not.toBeNull(); // stays due for re-poll

    const second = await projectEntity(deps(), REF, "c2");
    expect(second.result).toBe("success");
    rec = store.raw(REF)!;
    expect(rec.meetState).toBe("ready");
    expect(rec.meetUrl).toBe("https://meet.google.com/x");
    expect(rec.nextAttemptAt).toBeNull();
  });
});

describe("projectEntity — deletion", () => {
  it("removes the projected event when the entity is gone", async () => {
    store.setDesired(REF, makeDraft());
    await projectEntity(deps(), REF, "c1");
    expect(store.raw(REF)!.googleEventId).toBe("ev-fixed");

    store.setDesired(REF, null); // entity deleted in Portal
    const r = await projectEntity(deps(), REF, "c2");
    expect(r).toMatchObject({ result: "success", operation: "delete" });
    const rec = store.raw(REF)!;
    expect(rec.googleEventId).toBeNull();
    expect(rec.syncState).toBe("synced");
    expect(provider.deletes).toBe(1);
  });

  it("does nothing when neither entity nor projection exists", async () => {
    const r = await projectEntity(deps(), REF, "c1");
    expect(r).toMatchObject({ result: "skipped", reason: "no_entity" });
  });
});

describe("observability", () => {
  it("logs one structured line per attempt with the required fields", async () => {
    store.setDesired(REF, makeDraft());
    await projectEntity(deps(), REF, "corr-xyz");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      correlationId: "corr-xyz",
      entityType: "meeting",
      entityId: UUID,
      googleCalendarId: "cal@example.com",
      operation: "create",
      result: "success",
    });
    expect(typeof logs[0].durationMs).toBe("number");
  });
});

describe("reconcilePending", () => {
  it("processes all due rows and summarises", async () => {
    const REF2: EntityRef = { entityType: "meeting", entityId: "00000000-0000-0000-0000-000000000002" };
    store.setDesired(REF, makeDraft());
    store.setDesired(REF2, makeDraft({ entityId: REF2.entityId }));
    await store.ensureProjection(REF, "cal@example.com");
    await store.ensureProjection(REF2, "cal@example.com");

    const summary = await reconcilePending(deps(), { limit: 10, correlationId: "batch-1" });
    expect(summary).toMatchObject({ processed: 2, succeeded: 2, failed: 0 });
  });
});
