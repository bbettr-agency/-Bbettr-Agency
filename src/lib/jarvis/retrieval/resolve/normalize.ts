/**
 * Jarvis Retrieval V2 — deterministic name normalization (PURE, no I/O).
 *
 * Unifies incidental spelling of business/person names so that a user's casual
 * reference ("A&S", "A and S", "Fine Art") can be resolved to a canonical Portal
 * client name — WITHOUT fuzzy matching, and WITHOUT ever guessing (ambiguity is
 * resolved by asking, upstream). This is not a security primitive.
 */

/** Legal-entity suffix tokens stripped from the end of a name. */
const SUFFIXES = new Set(["pty", "ltd", "limited", "inc", "incorporated", "cc", "llc"]);

/** Lowercase, accent-fold, normalise "&"↔"and", strip punctuation + legal suffixes. */
export function normalizeName(input: string): string {
  const folded = (input ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/&/g, " and ") // A&S / A & S → "a and s"
    .replace(/[^a-z0-9\s]/g, " ") // drop punctuation (keep alnum + spaces)
    .replace(/\s+/g, " ")
    .trim();
  // Strip trailing legal suffixes (repeatedly: "… pty ltd").
  const tokens = folded.split(" ").filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

/** Tokenize a normalized string into whole words. */
export function tokenize(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

/**
 * Whether a matched run of tokens is specific enough to resolve on. Conservative:
 *  - a single token must be >= 4 chars (a 3-char token like "art"/"fox" is too
 *    generic on its own);
 *  - a multi-word phrase must be >= 3 chars overall.
 * NOT fuzzy matching — only gates eligibility.
 */
export function isMatchableRun(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const joined = tokens.join("");
  if (joined.length < 3) return false;
  if (tokens.length === 1 && tokens[0].length < 4) return false;
  return true;
}

/** Whether `needle` (token array) appears as a contiguous run within `haystack`. */
export function containsContiguous(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}
