import "server-only";

/**
 * Jarvis Intelligence — provider-independent LLM contract (Slice B).
 *
 * SERVER-ONLY: this is the executable provider runtime contract (LLMProvider
 * .complete). Browser/UI code must never import the runtime provider layer; if a
 * browser-safe DISPLAY type is ever needed, extract it deliberately into a
 * separate shared module rather than importing from here. (Type-only imports of
 * these interfaces are erased at compile time and remain safe anywhere.)
 *
 * Pure types. This is the ONLY boundary between Jarvis and any model vendor.
 * It is deliberately narrow: a bounded request in, a model response out. It does
 * NOT carry — and must never carry — any authority or data-access capability:
 * no Supabase client, no JarvisContext, no grants, no workspace authority, no
 * capability-execution functions, no service-role, no DB access. The provider is
 * a computation, not a security boundary; all authority lives in the trusted
 * orchestrator/F1 layers (Slice C+).
 *
 * Slice B intentionally does NOT define any Jarvis operational response schema
 * (proposed intents, memory candidates, provenance, uncertainty, reasoning
 * summary) — the provider returns raw model text; parsing Jarvis semantics is
 * Slice C/D.
 */

/** A conversation turn sent to the model. There is no `system` role here — the
 *  trusted system instructions travel as the separate `system` field below, so
 *  message content can never be treated as system instructions. */
export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMCompletionRequest {
  /** Trusted system instructions, assembled by the caller (never model/user text). */
  system: string;
  /** Bounded conversation history + the current user turn. */
  messages: LLMMessage[];
  /** Hard cap on model output length for this call. */
  maxOutputTokens: number;
  /**
   * The approved wall-clock budget for this call. AUTHORITY NOTE: the provider is
   * NOT responsible for guaranteeing the overall turn deadline — the trusted
   * orchestrator (Slice C) owns it and MUST independently abort via `signal` when
   * the deadline expires. An adapter MAY apply its own timeout as extra defense,
   * but the caller/orchestrator remains authoritative.
   */
  timeoutMs: number;
  /** Cancellation signal the orchestrator wires to the deadline; adapters honor it. */
  signal?: AbortSignal;
  /**
   * OPTIONAL structured-output request. When set, the adapter should use a
   * provider-NATIVE mechanism (e.g. Anthropic forced tool use) to make the model
   * return EXACTLY one JSON object conforming to `schema`, and return that object
   * serialized as `result.text`. Adapters that cannot enforce it MUST ignore this
   * field and return plain text — the caller validates strictly either way, so this
   * only improves reliability and never relaxes the response contract.
   */
  jsonSchema?: { name: string; description?: string; schema: Record<string, unknown> };
}

export interface LLMUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LLMCompletionResult {
  /** Raw model output text. No Jarvis semantics are parsed at this layer. */
  text: string;
  /** Adapter-derived, trusted metadata (never model-claimed). */
  providerId: string;
  model: string;
  /** Provider-mapped stop reason (e.g. "stop" | "length" | "content_filter"), or null. */
  finishReason: string | null;
  usage: LLMUsage;
  latencyMs: number;
}

// ── Bounded tool-use (agentic read) — Milestone A ────────────────────────────
// An OPTIONAL provider capability for the bounded multi-tool read loop. It does NOT
// widen the provider's authority: the provider only relays tool SCHEMAS and returns
// the model's tool-call requests; all tool EXECUTION (and all data access) happens in
// the trusted orchestrator/executor under RLS. Providers that cannot do tool use omit
// `completeWithTools`, and the agentic path simply stays unavailable for them.

/** A read-tool the model may invoke this round. `inputSchema` is JSON Schema. */
export interface LLMToolSpec {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** Forcing strategy. "any" forces SOME tool call every round (keeps every model output
 *  schema-controlled — no free prose); "tool" forces one specific tool; "auto" lets the
 *  model choose whether to call a tool. */
export type LLMToolChoice = { type: "auto" } | { type: "any" } | { type: "tool"; name: string };

export type LLMTextBlock = { type: "text"; text: string };
export type LLMToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type LLMToolResultBlock = { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };
export type LLMContentBlock = LLMTextBlock | LLMToolUseBlock | LLMToolResultBlock;

/** A conversation entry that may carry structured content blocks (tool_use/tool_result)
 *  in addition to plain text. Still no system role — system travels separately. */
export interface LLMToolMessage {
  role: "user" | "assistant";
  content: string | LLMContentBlock[];
}

export interface LLMToolRequest {
  /** Trusted system instructions (never model/user text). */
  system: string;
  messages: LLMToolMessage[];
  /** The registered read tools exposed this round (plus the final-answer tool). */
  tools: LLMToolSpec[];
  toolChoice: LLMToolChoice;
  maxOutputTokens: number;
  /** Per-call wall-clock budget; the orchestrator owns the overall turn deadline. */
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface LLMToolResult {
  /** Every tool-call the model requested this round (zero or more). */
  toolUses: LLMToolUseBlock[];
  /** Any text blocks (normally empty under tool_choice "any"/"tool"). */
  text: string;
  providerId: string;
  model: string;
  finishReason: string | null;
  usage: LLMUsage;
  latencyMs: number;
}

/**
 * A configured provider. `complete` resolves with a result on success, or throws
 * an LLMProviderError (see errors.ts) on any failure — so callers classify
 * retryable vs non-retryable via the typed error, not by parsing strings.
 * `completeWithTools` is the OPTIONAL bounded tool-use turn (agentic read).
 */
export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
  completeWithTools?(request: LLMToolRequest): Promise<LLMToolResult>;
}
