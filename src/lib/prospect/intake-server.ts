/**
 * Secure public-intake service layer (P2-C) — orchestration only.
 *
 * The DB and Turnstile are injected (ProspectIntakeStore + TurnstileVerifier) so
 * the security-critical flows are unit-testable without any real I/O. The thin
 * server actions (app/start/actions.ts) wire the real service-role store + real
 * Turnstile. This module performs NO direct I/O and holds NO secrets.
 *
 * The public mutation chain: honeypot → Turnstile (create/submit) → validation →
 * token+lifecycle → complete-data normalize (P2-B) → derive columns → store.
 */
import {
  hashIntakeToken,
  isWellFormedIntakeToken,
  isIntakeTokenExpired,
  issueIntakeToken,
} from "./intake-token";
import {
  tokenCapability,
  isTerminalStatus,
  type ProspectIntakeStatus,
  type ProspectSource,
} from "./intake-lifecycle";
import {
  normalizeIntake,
  normalizeIntakeData,
  mergeIntakePatch,
  derivePromotedColumns,
  type PromotedColumns,
} from "./intake-normalize";
import { validateBusiness, validateForSubmit, type FieldErrors } from "./intake-validation";

export type { PromotedColumns };

// ── Injected boundaries ─────────────────────────────────────────────────────

export interface StoredIntake {
  id: string;
  status: ProspectIntakeStatus;
  source: ProspectSource;
  token_expires_at: string;
  /**
   * Optimistic-concurrency version. `prospect_intakes.updated_at` is bumped by a
   * BEFORE UPDATE trigger (`set_updated_at`) on EVERY write, so it doubles as a
   * compare-and-swap token: submit only transitions the row if this exact
   * DB-returned value is still current — proving no save landed after the read.
   * It is carried through verbatim (never reformatted / truncated in JS).
   */
  updated_at: string;
  /** Full canonical data incl. server-owned reserved keys (e.g. _prefill). */
  data: Record<string, unknown>;
}

export interface ProspectIntakeStore {
  insertDraft(input: {
    token_hash: string;
    token_expires_at: string;
    source: ProspectSource;
    data: Record<string, unknown>;
    columns: PromotedColumns;
  }): Promise<{ id: string }>;
  findByTokenHash(tokenHash: string): Promise<StoredIntake | null>;
  /**
   * Atomic draft-only update (WHERE status='draft'). Returns true ONLY if a live
   * draft row was actually written. The status guard lives at the DB mutation
   * boundary — never on a stale pre-read — so a save can never mutate a row that
   * another request has already transitioned out of `draft`.
   */
  updateDraftData(id: string, data: Record<string, unknown>, columns: PromotedColumns): Promise<boolean>;
  /**
   * Compare-and-swap submit claim: transition draft→submitted ONLY WHERE
   * status='draft' AND updated_at = expectedUpdatedAt. Writes NOTHING but
   * status + submitted_at, so it can never carry a stale data snapshot back into
   * the row. Returns true ONLY for the single request whose validated version is
   * still current at the claim boundary.
   */
  claimSubmit(id: string, expectedUpdatedAt: string, submittedAt: string): Promise<boolean>;
}

export interface TurnstileVerifier {
  verify(token: string | null | undefined): Promise<{ ok: boolean; configured: boolean }>;
}

export interface SubmitNotification {
  /** The submitted intake's row id — lets the admin notification deep-link to it. */
  intakeId: string;
  businessName: string | null;
  contactName: string | null;
  selectedServices: string[];
  uncertain: boolean;
}

// ── Public result model (typed, generic user-facing) ────────────────────────

export type IntakeErrorKind =
  | "validation_error"
  | "verification_failed"
  | "invalid_or_closed"
  | "expired"
  | "already_submitted"
  | "save_failed"
  | "configuration_error"
  /** Sustained save contention exhausted the submit retry bound — safe to retry. */
  | "conflict";

export interface PublicIntakeView {
  status: ProspectIntakeStatus;
  canRead: boolean;
  canMutate: boolean;
  /** Current editable answers ONLY — reserved (`_`-prefixed) keys stripped. */
  data: Record<string, unknown>;
}

export type CreateResult =
  | { kind: "success"; token: string; view: PublicIntakeView }
  | { kind: IntakeErrorKind; errors?: FieldErrors };
export type SaveResult =
  | { kind: "success"; view: PublicIntakeView }
  | { kind: IntakeErrorKind; errors?: FieldErrors };
export type SubmitResult =
  | { kind: "success"; view: PublicIntakeView }
  | { kind: IntakeErrorKind; errors?: FieldErrors; view?: PublicIntakeView };

export type ResolveResult =
  | { kind: "ok"; row: StoredIntake }
  | { kind: "already_submitted"; row: StoredIntake }
  | { kind: "expired" }
  | { kind: "invalid_or_closed" };

// ── Honeypot + payload bounds (defense-in-depth) ────────────────────────────

/** Non-semantic hidden field name — autofill/password managers won't touch it. */
export const HONEYPOT_FIELD = "secondary_reference";
export function isHoneypotFilled(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const MAX_PATCH_KEYS = 40;
const MAX_PATCH_BYTES = 20_000;
export function withinPayloadBounds(patch: unknown): boolean {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch == null;
  if (Object.keys(patch as object).length > MAX_PATCH_KEYS) return false;
  try {
    return JSON.stringify(patch).length <= MAX_PATCH_BYTES;
  } catch {
    return false;
  }
}

// ── Views ───────────────────────────────────────────────────────────────────

function stripReserved(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!k.startsWith("_")) out[k] = v;
  return out;
}
function publicView(status: ProspectIntakeStatus, data: Record<string, unknown>): PublicIntakeView {
  const cap = tokenCapability(status, false); // resolved rows here are non-expired
  return { status, canRead: cap.canRead, canMutate: cap.canMutate, data: stripReserved(data) };
}

// ── Token resolution (non-enumerating) ──────────────────────────────────────

/**
 * Resolve a raw token to a lifecycle result. Malformed / unknown / terminal
 * (converted|dismissed) all collapse to `invalid_or_closed` so nothing beyond
 * the approved user-facing state can be inferred.
 */
export async function resolveIntake(
  store: ProspectIntakeStore,
  rawToken: unknown,
  now: Date = new Date()
): Promise<ResolveResult> {
  if (!isWellFormedIntakeToken(rawToken)) return { kind: "invalid_or_closed" };
  const row = await store.findByTokenHash(hashIntakeToken(rawToken));
  if (!row) return { kind: "invalid_or_closed" };
  if (isTerminalStatus(row.status)) return { kind: "invalid_or_closed" }; // converted/dismissed
  if (isIntakeTokenExpired(row.token_expires_at, now)) return { kind: "expired" };
  if (row.status === "submitted") return { kind: "already_submitted", row };
  return { kind: "ok", row }; // draft, live
}

/** Public-safe resolution for /start/<token> — never returns the raw row. */
export async function resolveIntakeView(
  store: ProspectIntakeStore,
  rawToken: unknown,
  now: Date = new Date()
): Promise<{ kind: ResolveResult["kind"]; view?: PublicIntakeView }> {
  const r = await resolveIntake(store, rawToken, now);
  if (r.kind === "ok" || r.kind === "already_submitted") {
    return { kind: r.kind, view: publicView(r.row.status, r.row.data) };
  }
  return { kind: r.kind };
}

// ── Create (generic draft) ──────────────────────────────────────────────────

export interface CreateDraftInput {
  contact_name?: unknown;
  business_name?: unknown;
  email?: unknown;
  phone?: unknown;
  existing_website_url?: unknown;
  location?: unknown;
  honeypot?: unknown;
  turnstileToken?: string | null;
}

export async function createGenericDraft(
  store: ProspectIntakeStore,
  verifier: TurnstileVerifier,
  input: CreateDraftInput,
  now: Date = new Date()
): Promise<CreateResult> {
  // 1. honeypot — silent, generic (no row, no detail leaked)
  if (isHoneypotFilled(input.honeypot)) return { kind: "verification_failed" };
  // 2. Turnstile — REQUIRED before any insert; fail closed
  const tv = await verifier.verify(input.turnstileToken);
  if (!tv.configured) return { kind: "configuration_error" };
  if (!tv.ok) return { kind: "verification_failed" };
  // 3. validate step 1
  const v = validateBusiness(input);
  if (!v.ok) return { kind: "validation_error", errors: v.errors };
  // 4. normalize canonical data (step 1 only) + derive columns
  const { data, columns } = normalizeIntake({
    contact_name: input.contact_name,
    business_name: input.business_name,
    email: input.email,
    phone: input.phone,
    existing_website_url: input.existing_website_url,
    location: input.location,
  });
  // 5. mint token (hash only stored) + insert — ONLY after every gate passed
  const tok = issueIntakeToken(now);
  try {
    await store.insertDraft({
      token_hash: tok.tokenHash,
      token_expires_at: tok.expiresAt,
      source: "generic",
      data,
      columns,
    });
  } catch {
    return { kind: "save_failed" };
  }
  return { kind: "success", token: tok.rawToken, view: publicView("draft", data) };
}

// ── Save (partial autosave; NO fresh Turnstile) ─────────────────────────────

export async function saveIntakeDraft(
  store: ProspectIntakeStore,
  rawToken: unknown,
  patch: unknown,
  now: Date = new Date()
): Promise<SaveResult> {
  const r = await resolveIntake(store, rawToken, now);
  if (r.kind === "expired") return { kind: "expired" };
  if (r.kind === "already_submitted") return { kind: "already_submitted" };
  if (r.kind !== "ok") return { kind: "invalid_or_closed" };
  if (!withinPayloadBounds(patch)) return { kind: "validation_error", errors: { form: "Too much data." } };

  // Partial-save contract: merge onto EXISTING canonical data, normalize the
  // COMPLETE object, derive columns after. Never normalize the bare patch.
  const merged = mergeIntakePatch(r.row.data, patch);
  const columns = derivePromotedColumns(merged);
  const updated = await store.updateDraftData(r.row.id, merged, columns).catch(() => false);
  if (!updated) return { kind: "invalid_or_closed" }; // status changed under us / write lost
  return { kind: "success", view: publicView("draft", merged) };
}

// ── Submit (versioned CAS claim; notify exactly once) ────────────────────────

/** Bounded submit retries under save contention — never an unbounded spin. */
const MAX_SUBMIT_ATTEMPTS = 3;

export async function submitIntake(
  store: ProspectIntakeStore,
  verifier: TurnstileVerifier,
  args: { rawToken: unknown; honeypot?: unknown; turnstileToken?: string | null },
  notify: (n: SubmitNotification) => Promise<void>,
  now: Date = new Date(),
  /** Server-side sink for a swallowed notify failure (log WITHOUT PII/token). */
  onNotifyError?: (err: unknown) => void
): Promise<SubmitResult> {
  if (isHoneypotFilled(args.honeypot)) return { kind: "verification_failed" };
  const tv = await verifier.verify(args.turnstileToken);
  if (!tv.configured) return { kind: "configuration_error" };
  if (!tv.ok) return { kind: "verification_failed" };

  const submittedAt = now.toISOString();

  // Compare-and-swap submit with bounded retry. Each attempt resolves the CURRENT
  // row, validates the COMPLETE current data, then claims ONLY that exact version
  // (WHERE status='draft' AND updated_at=<the read snapshot>). A save that lands
  // between our read and our claim moves updated_at, the CAS misses, and we
  // re-read / re-validate / re-claim the NEW version. The row that transitions
  // draft→submitted is therefore ALWAYS exactly the version we validated — never
  // a stale snapshot, and a concurrent save is never overwritten.
  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt++) {
    const r = await resolveIntake(store, args.rawToken, now);
    if (r.kind === "already_submitted") return { kind: "already_submitted", view: publicView("submitted", r.row.data) };
    if (r.kind === "expired") return { kind: "expired" };
    if (r.kind !== "ok") return { kind: "invalid_or_closed" };

    // Validate the COMPLETE current snapshot (never a bare patch or earlier read).
    const data = normalizeIntakeData(r.row.data);
    const v = validateForSubmit(data);
    if (!v.ok) return { kind: "validation_error", errors: v.errors };

    // CAS on the DB-returned updated_at. The claim writes NO data/columns — its
    // only effect is the lifecycle transition of this precise version.
    const claimed = await store.claimSubmit(r.row.id, r.row.updated_at, submittedAt).catch(() => false);
    if (!claimed) continue; // a save or a concurrent submit moved the row — re-resolve

    // Won the claim. The row's persisted data IS `data` (CAS proved it unchanged
    // since validation), so notify from the validated snapshot reflects the row
    // that actually became submitted. Notification is best-effort: a submitted
    // intake must NOT revert if it fails; the prospect still gets success and the
    // failure is logged server-side via the injected sink (no token/PII/data).
    const columns = derivePromotedColumns(data);
    try {
      await notify({
        intakeId: r.row.id,
        businessName: columns.business_name,
        contactName: columns.contact_name,
        selectedServices: columns.selected_services,
        uncertain: data.services_uncertain === true,
      });
    } catch (err) {
      onNotifyError?.(err);
    }
    return { kind: "success", view: publicView("submitted", data) };
  }

  // Sustained contention beyond the retry bound: never submit an unvalidated
  // version. The row is untouched and the caller may safely retry.
  return { kind: "conflict" };
}
