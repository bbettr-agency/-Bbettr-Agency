import type { EntityCandidate, EntityResolution, MatchTier } from "@/lib/jarvis/retrieval/types";
import { normalizeName, tokenize, isMatchableRun, containsContiguous } from "./normalize";

/**
 * PURE client name resolution (no I/O). Given the raw user message and the list of
 * clients the principal may read under RLS, decide: no match, exactly one, or
 * several (→ clarify). Deterministic. Never guesses, never picks the first row,
 * and only ever uses ids that came from the authorized client list.
 *
 * Tiers (strongest → weakest): exact (whole name present) > all_tokens (every name
 * token present) > prefix (a leading run of the name present) > substring. A user
 * fragment like "A&S" resolves to "A&S Wholesalers" via the prefix tier; a fuller
 * "A&S Wholesalers" wins by exact + more matched tokens.
 */

export interface ClientLike {
  id: string;
  name: string;
  company?: string | null;
}

const TIER_RANK: Record<MatchTier, number> = {
  exact: 4,
  normalized: 4,
  all_tokens: 3,
  prefix: 2,
  substring: 1,
};
const TIER_CONFIDENCE: Record<MatchTier, number> = {
  exact: 1.0,
  normalized: 0.95,
  all_tokens: 0.85,
  prefix: 0.7,
  substring: 0.55,
};

interface FieldMatch {
  tier: MatchTier;
  matchedTokens: number;
}

/** Best match of one candidate field (a client name or company) against the message. */
function matchField(messageTokens: string[], messageJoined: string, field: string): FieldMatch | null {
  const norm = normalizeName(field);
  const C = tokenize(norm);
  if (C.length === 0) return null;

  // Largest matchable prefix of the name present as a contiguous run in the message.
  let bestPrefixK = 0;
  for (let k = C.length; k >= 1; k--) {
    const run = C.slice(0, k);
    if (isMatchableRun(run) && containsContiguous(messageTokens, run)) {
      bestPrefixK = k;
      break;
    }
  }
  if (bestPrefixK === C.length) return { tier: "exact", matchedTokens: C.length };

  // all_tokens: every name token present somewhere (order-independent).
  const msgSet = new Set(messageTokens);
  if (isMatchableRun(C) && C.every((t) => msgSet.has(t))) {
    return { tier: "all_tokens", matchedTokens: C.length };
  }

  if (bestPrefixK >= 1) return { tier: "prefix", matchedTokens: bestPrefixK };

  // substring of the joined message.
  if (isMatchableRun(C) && messageJoined.includes(norm.replace(/\s+/g, ""))) {
    return { tier: "substring", matchedTokens: C.length };
  }
  return null;
}

interface Scored {
  candidate: EntityCandidate;
  rank: number;
  matchedTokens: number;
}

export function resolveClientFromList(rawMessage: string, clients: ClientLike[]): EntityResolution {
  const messageTokens = tokenize(normalizeName(rawMessage));
  const messageJoined = messageTokens.join("");

  const scored: Scored[] = [];
  for (const c of clients) {
    const name = (c.name ?? "").trim();
    if (!name) continue;
    const nameMatch = matchField(messageTokens, messageJoined, name);
    const companyMatch = c.company ? matchField(messageTokens, messageJoined, c.company) : null;

    // Keep the stronger of name/company (name wins ties).
    let best: { m: FieldMatch; matchedOn: "name" | "company" } | null = null;
    if (nameMatch) best = { m: nameMatch, matchedOn: "name" };
    if (companyMatch && (!best || TIER_RANK[companyMatch.tier] > TIER_RANK[best.m.tier])) {
      best = { m: companyMatch, matchedOn: "company" };
    }
    if (!best) continue;

    scored.push({
      candidate: {
        kind: "client",
        id: c.id,
        canonicalName: name,
        matchedOn: best.matchedOn,
        tier: best.m.tier,
        confidence: TIER_CONFIDENCE[best.m.tier],
      },
      rank: TIER_RANK[best.m.tier],
      matchedTokens: best.m.matchedTokens,
    });
  }

  if (scored.length === 0) return { status: "none", kind: "client", query: rawMessage };

  // Best tier, then most matched tokens (a fuller reference wins over a nested shorter one).
  const maxRank = Math.max(...scored.map((s) => s.rank));
  const topTier = scored.filter((s) => s.rank === maxRank);
  const maxTok = Math.max(...topTier.map((s) => s.matchedTokens));
  const winners = topTier.filter((s) => s.matchedTokens === maxTok);

  if (winners.length === 1) return { status: "one", kind: "client", entity: winners[0].candidate };

  const candidates = winners
    .map((s) => s.candidate)
    .sort((a, b) => b.confidence - a.confidence || a.canonicalName.localeCompare(b.canonicalName));
  return { status: "many", kind: "client", candidates };
}
