import { describe, it, expect, vi } from "vitest";
import { emitMeetingInvitations } from "./invitation-service";
import type { SendResult } from "@/lib/email/resend";
import type { sendMeetingInvitationEmail } from "@/lib/email/meeting-notifications";

type SendFn = typeof sendMeetingInvitationEmail;

/**
 * Minimal in-memory fake of the service-role Supabase client — supports exactly
 * the query shapes emitMeetingInvitations uses: chained .eq filters, .maybeSingle,
 * insert().select().single() (with UNIQUE enforcement), and update().eq.
 */
type Row = Record<string, unknown>;
const UNIQUE = ["meeting_id", "attendee_email", "sequence", "method"] as const;
let idSeq = 0;

class Query {
  filters: [string, unknown][] = [];
  private _insert: Row | null = null;
  private _update: Row | null = null;
  constructor(private store: Record<string, Row[]>, private table: string) {}
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  insert(row: Row) {
    this._insert = row;
    return this;
  }
  update(patch: Row) {
    this._update = patch;
    return this;
  }
  private rows() {
    return (this.store[this.table] ?? []).filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }
  async maybeSingle() {
    return { data: this.rows()[0] ?? null, error: null };
  }
  async single() {
    if (this._insert) return this.doInsert();
    return { data: this.rows()[0] ?? null, error: null };
  }
  private doInsert() {
    const table = (this.store[this.table] ??= []);
    const conflict = table.find((r) => UNIQUE.every((k) => r[k] === this._insert![k]));
    if (conflict) return { data: null, error: { code: "23505", message: "unique" } };
    const row: Row = {
      id: `inv_${++idSeq}`,
      resend_message_id: null,
      last_error: null,
      sent_at: null,
      delivered_at: null,
      ...this._insert,
    };
    table.push(row);
    return { data: { id: row.id }, error: null };
  }
  then<T>(resolve: (v: { data: Row[]; error: null }) => T) {
    if (this._update) {
      for (const r of this.rows()) Object.assign(r, this._update);
      return Promise.resolve({ data: [], error: null }).then(resolve);
    }
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve);
  }
}

function makeAdmin(store: Record<string, Row[]>) {
  return { from: (table: string) => new Query(store, table) } as never;
}

const MEETING_ID = "m-1";
const HOST_ID = "u-eloff";

function seed(overrides: Partial<Row> = {}): Record<string, Row[]> {
  return {
    meetings: [
      {
        id: MEETING_ID,
        title: "Kickoff",
        description: "Intro",
        starts_at: "2026-10-15T09:00:00.000Z",
        ends_at: "2026-10-15T10:00:00.000Z",
        time_zone: "Africa/Johannesburg",
        has_meet: true,
        status: "scheduled",
        deleted_at: null,
        created_by: HOST_ID,
        ...overrides,
      },
    ],
    meeting_attendees: [
      { meeting_id: MEETING_ID, email: "a@x.com", display_name: "Aay" },
      { meeting_id: MEETING_ID, email: "b@y.com", display_name: null },
    ],
    calendar_projections: [{ entity_type: "meeting", entity_id: MEETING_ID, meet_url: "https://meet.google.com/abc-defg-hij" }],
    profiles: [{ id: HOST_ID, full_name: "Eloff Sander" }],
    meeting_invitations: [],
  };
}

const okSend = () =>
  vi.fn<SendFn>(async (): Promise<SendResult> => ({ ok: true, id: `msg_${Math.random().toString(36).slice(2)}` }));
const now = () => () => new Date("2026-09-30T10:00:00.000Z");

describe("emitMeetingInvitations", () => {
  it("CREATE: sends a REQUEST to each attendee and records a 'sent' ledger row with the message id", async () => {
    const store = seed();
    const send = okSend();
    const out = await emitMeetingInvitations(MEETING_ID, { admin: makeAdmin(store), now: now(), send });

    expect(out.ok).toBe(true);
    expect(out.sent).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.every((c) => c[0].icsMethod === "REQUEST" && c[0].cancelled === false)).toBe(true);
    expect(send.mock.calls.map((c) => c[0].to).sort()).toEqual(["a@x.com", "b@y.com"]);
    // host name flows into the email + organizer
    expect(send.mock.calls[0][0].hostName).toBe("Eloff Sander");
    const led = store.meeting_invitations;
    expect(led).toHaveLength(2);
    expect(led.every((r) => r.status === "sent" && r.method === "request" && r.sequence === 0 && r.resend_message_id)).toBe(true);
    expect(led.every((r) => r.ics_uid === "m-1@portal.bbettragency.com")).toBe(true);
  });

  it("IDEMPOTENT: a second identical emit sends nothing new", async () => {
    const store = seed();
    await emitMeetingInvitations(MEETING_ID, { admin: makeAdmin(store), now: now(), send: okSend() });
    const send2 = okSend();
    const out = await emitMeetingInvitations(MEETING_ID, { admin: makeAdmin(store), now: now(), send: send2 });
    expect(send2).not.toHaveBeenCalled();
    expect(out.attempted).toBe(0);
    expect(store.meeting_invitations).toHaveLength(2);
  });

  it("RESEND FAILURE: records status 'failed' and reports it honestly (never a clean 'sent')", async () => {
    const store = seed();
    const send = vi.fn<SendFn>(async (): Promise<SendResult> => ({ ok: false, error: "SMTP 550 rejected\nsecond line" }));
    const out = await emitMeetingInvitations(MEETING_ID, { admin: makeAdmin(store), now: now(), send });
    expect(out.ok).toBe(false);
    expect(out.failed).toBe(2);
    expect(out.sent).toBe(0);
    expect(store.meeting_invitations.every((r) => r.status === "failed")).toBe(true);
    // sanitized: single line, bounded
    expect((store.meeting_invitations[0].last_error as string).includes("\n")).toBe(false);
    // failure is retryable on a later emit
    const send2 = okSend();
    const retry = await emitMeetingInvitations(MEETING_ID, { admin: makeAdmin(store), now: now(), send: send2 });
    expect(send2).toHaveBeenCalledTimes(2);
    expect(retry.sent).toBe(2);
  });

  it("CANCEL: previously-invited attendees receive a CANCEL invitation", async () => {
    const store = seed();
    await emitMeetingInvitations(MEETING_ID, { admin: makeAdmin(store), now: now(), send: okSend() });
    // now cancel the meeting
    (store.meetings[0] as Row).status = "cancelled";
    const send = okSend();
    const out = await emitMeetingInvitations(MEETING_ID, { admin: makeAdmin(store), now: now(), send });
    expect(out.sent).toBe(2);
    expect(send.mock.calls.every((c) => c[0].icsMethod === "CANCEL" && c[0].cancelled === true)).toBe(true);
    const cancels = store.meeting_invitations.filter((r) => r.method === "cancel");
    expect(cancels).toHaveLength(2);
    expect(cancels.every((r) => r.sequence === 1)).toBe(true);
  });

  it("returns meeting_not_found when the meeting is absent", async () => {
    const out = await emitMeetingInvitations("nope", { admin: makeAdmin(seed()), now: now(), send: okSend() });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("meeting_not_found");
  });
});
