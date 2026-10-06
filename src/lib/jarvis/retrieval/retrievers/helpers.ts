import "server-only";

import type {
  AuthorityClass,
  DomainKey,
  EntityRef,
  EvidenceFact,
  RetrieverResult,
  RetrieverStatus,
} from "../types";

/** Build one normalized evidence fact. */
export function fact(
  domain: DomainKey,
  authority: AuthorityClass,
  entity: EntityRef,
  label: string,
  value: unknown,
  source: string,
  opts: { occurredAt?: string | null; recordRef?: string; partial?: boolean } = {}
): EvidenceFact {
  return {
    domain,
    authority,
    entity,
    label,
    value,
    source,
    occurredAt: opts.occurredAt ?? null,
    recordRef: opts.recordRef,
    partial: opts.partial,
  };
}

/** Latest (max) timestamp among a set of ISO strings, or null. */
export function freshest(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || v > best)) best = v;
  return best;
}

export function result(
  domain: DomainKey,
  authority: AuthorityClass,
  facts: EvidenceFact[],
  opts: { returned: number; available: number | null; freshestAt?: string | null; tookMs: number; status?: RetrieverStatus }
): RetrieverResult {
  const truncated = opts.available != null && opts.available > opts.returned;
  const status: RetrieverStatus =
    opts.status ?? (facts.length === 0 ? "empty" : truncated ? "truncated" : "ok");
  return {
    domain,
    authority,
    status,
    facts,
    returnedCount: opts.returned,
    availableCount: opts.available,
    truncated,
    freshestAt: opts.freshestAt ?? null,
    tookMs: opts.tookMs,
  };
}

export function errorResult(domain: DomainKey, authority: AuthorityClass, tookMs: number): RetrieverResult {
  return {
    domain,
    authority,
    status: "error",
    facts: [],
    returnedCount: 0,
    availableCount: null,
    truncated: false,
    freshestAt: null,
    error: "query_failed", // safe class only — never a raw provider body
    tookMs,
  };
}

/** Wrap a retriever body: times it and converts any throw into a safe error result. */
export async function timed(
  domain: DomainKey,
  authority: AuthorityClass,
  now: () => Date,
  fn: (startMs: number) => Promise<RetrieverResult>
): Promise<RetrieverResult> {
  const startMs = now().getTime();
  try {
    return await fn(startMs);
  } catch {
    return errorResult(domain, authority, now().getTime() - startMs);
  }
}
