import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { ContextPlan } from "./types";

/**
 * Jarvis Intelligence — deterministic context router (Slice C).
 *
 * The LLM never decides which records it receives. This pure-ish resolver maps a
 * message to a ContextPlan using only: (1) exact whole-word matches against the
 * clients the authenticated user is authorized to read under RLS, and (2) the
 * thread's stored deterministic referent (last_client_id), re-authorized on use.
 * Ambiguous (>1 match) or unresolved referents return a clarification plan — we
 * never guess, never fuzzy-match, and never trust a model-supplied client id.
 */

// Deliberately conservative: possessive "my", explicit first-person task framing,
// and "…to/on me" idioms. We do NOT match bare "i"/"me" — those fire on innocuous
// phrasing like "give me a status" and would wrongly narrow to the user scope.
const PERSONAL_RE = /\bmy\b|\bwhat should i\b|\bfocus (on )?today\b|\b(waiting on|assigned to) me\b|\bon my plate\b/i;
const STRONG_REFERENT_RE = /\b(that|this|the) client\b/i;
const WEAK_REFERENT_RE = /\b(them|they|their|it|those)\b/i;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a client name is specific enough to safely EXACT-match ordinary
 * language. Conservative by design (we would rather ask than mis-route):
 *   • a single-token name must be ≥ 4 chars (a 3-char token like "art"/"fox" is
 *     too generic to match on its own);
 *   • a multi-word name must be ≥ 3 chars overall (two short words are specific
 *     enough as a phrase, e.g. "fine art printers").
 * This is NOT fuzzy matching — it only decides whether a name is eligible for the
 * whole-phrase, word-boundary test below.
 */
function isMatchableName(norm: string): boolean {
  if (norm.length < 3) return false;
  const singleToken = !norm.includes(" ");
  if (singleToken && norm.length < 4) return false;
  return true;
}

/** Exact, whole-phrase, word-boundary, case-insensitive match. No substrings:
 *  "studio" never matches "Signage Studio"; "glob" never matches "Globex". */
function nameMatches(normMessage: string, clientName: string): boolean {
  const n = normalize(clientName);
  if (!isMatchableName(n)) return false;
  return new RegExp(`\\b${escapeRegex(n)}\\b`).test(normMessage);
}

interface RoutableThread {
  lastClientId: string | null;
}

/** Resolve the deterministic context plan for a turn. */
export async function planContext(_ctx: JarvisContext, message: string, thread: RoutableThread): Promise<ContextPlan> {
  const norm = normalize(message);

  // Clients the authenticated user may read under existing Portal RLS.
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, name");
  const clients = (data ?? [])
    .map((c) => ({ id: c.id as string, name: (c.name as string | null) ?? "" }))
    .filter((c) => c.name.trim().length > 0);

  // DETERMINISTIC PRECEDENCE:
  //   1. an EXPLICIT exact client name in the message ALWAYS wins — including over
  //      a stored referent (checked first, below);
  //   2. >1 authorized client matching (distinct clients, duplicate normalized
  //      names, or one name nested in another) ⇒ AMBIGUOUS — we NEVER pick the
  //      first DB row;
  //   3. otherwise fall through to referent / personal / agency.
  const matches = clients.filter((c) => nameMatches(norm, c.name));
  if (matches.length === 1) return { kind: "client", clientId: matches[0].id, clientName: matches[0].name };
  if (matches.length > 1) return { kind: "ambiguous_client", candidates: matches.map((m) => ({ id: m.id, name: m.name })) };

  const strong = STRONG_REFERENT_RE.test(message);
  const weak = WEAK_REFERENT_RE.test(message);

  if (thread.lastClientId && (strong || weak)) {
    // Re-authorize the stored referent before reuse (client may have been removed
    // or become inaccessible — never leak).
    const still = clients.find((c) => c.id === thread.lastClientId);
    if (still) return { kind: "client", clientId: still.id, clientName: still.name };
    return { kind: "unknown_client" };
  }
  if (strong && !thread.lastClientId) return { kind: "unknown_client" };

  if (PERSONAL_RE.test(message)) return { kind: "user" };
  return { kind: "agency" };
}
