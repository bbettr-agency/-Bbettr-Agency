/**
 * Jarvis Memory V1 — deterministic secret-exclusion guard (pure, no I/O).
 *
 * Memory must NEVER store credentials or bank data (Part 13). This module makes
 * a DETERMINISTIC, high-confidence, fail-closed decision. It intentionally does
 * NOT pretend to detect every possible secret — it blocks high-confidence
 * patterns and anything the caller explicitly LABELS as secret, and the wider
 * ingestion policy keeps automatic acceptance narrow for everything uncertain.
 *
 * CRITICAL: the result carries only SAFE category labels — never the matched
 * text — so a rejected secret is never echoed into an audit event or log.
 */

export type SecretCategory =
  | "declared_secret"
  | "private_key"
  | "jwt"
  | "api_key"
  | "aws_key"
  | "google_key"
  | "slack_token"
  | "stripe_key"
  | "github_pat"
  | "password_assignment"
  | "card_number"
  | "bank_details";

export interface SecretScanResult {
  blocked: boolean;
  /** Deduplicated safe category labels (NO secret content). */
  categories: SecretCategory[];
}

// ── High-confidence patterns (structure-based, low false-positive) ───────────
const PATTERNS: ReadonlyArray<{ category: SecretCategory; re: RegExp }> = [
  { category: "private_key", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/ },
  // JWT: three base64url segments — covers Supabase service-role keys, bearer JWTs.
  { category: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { category: "aws_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { category: "google_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { category: "slack_token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { category: "stripe_key", re: /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}\b/ },
  { category: "github_pat", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{20,}\b/ },
  // Generic provider secret keys: sk-... (OpenAI/Anthropic style), SendGrid SG.x.y
  { category: "api_key", re: /\bsk-[0-9A-Za-z_-]{16,}\b/ },
  { category: "api_key", re: /\bSG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}\b/ },
];

// key: value / key = value where the KEY names a secret and a value follows.
const ASSIGNMENT_RE =
  /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|bearer|client[_-]?secret|service[_-]?role[_-]?key|private[_-]?key)\b\s*[:=]\s*\S+/i;

// Bank/FNB details: an explicit banking label near a digit run.
const BANK_LABEL_RE = /\b(?:account\s*(?:no\.?|number|#)|branch\s*code|sort\s*code|iban|swift|bic|fnb|first\s*national\s*bank)\b/i;
const DIGIT_RUN_RE = /\b\d[\d\s-]{5,}\d\b/;

// Candidate card number: 13–19 digits allowing spaces/dashes.
const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){13,19}\b/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0 && digits.length >= 13 && digits.length <= 19;
}

function hasCardNumber(text: string): boolean {
  const matches = text.match(CARD_CANDIDATE_RE);
  if (!matches) return false;
  for (const m of matches) {
    const digits = m.replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

/**
 * Scan text for prohibited secret material. `declaredSecret` is a fail-closed
 * flag: when the caller marks the input as secret, it is ALWAYS blocked.
 */
export function scanForSecrets(text: string, declaredSecret = false): SecretScanResult {
  const found = new Set<SecretCategory>();
  if (declaredSecret) found.add("declared_secret");

  const sample = typeof text === "string" ? text : "";
  for (const { category, re } of PATTERNS) {
    if (re.test(sample)) found.add(category);
  }
  if (ASSIGNMENT_RE.test(sample)) found.add("password_assignment");
  if (BANK_LABEL_RE.test(sample) && DIGIT_RUN_RE.test(sample)) found.add("bank_details");
  if (hasCardNumber(sample)) found.add("card_number");

  return { blocked: found.size > 0, categories: [...found] };
}

/** Convenience: scan several fields (claim + body + serialized structured). */
export function scanMemoryContent(parts: {
  claim?: string | null;
  body?: string | null;
  structured?: unknown;
  declaredSecret?: boolean;
}): SecretScanResult {
  const chunks: string[] = [];
  if (parts.claim) chunks.push(parts.claim);
  if (parts.body) chunks.push(parts.body);
  if (parts.structured !== undefined && parts.structured !== null) {
    try {
      chunks.push(JSON.stringify(parts.structured));
    } catch {
      /* non-serializable → ignore; store layer validates shape separately */
    }
  }
  return scanForSecrets(chunks.join("\n"), parts.declaredSecret ?? false);
}
