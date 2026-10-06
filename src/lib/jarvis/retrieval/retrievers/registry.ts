import "server-only";

import type { DomainKey, RetrieverDescriptor } from "../types";
import { PORTAL_RETRIEVERS } from "./portal";
import { memoryRetriever } from "./memory";

/**
 * The retriever registry — a FROZEN allowlist of typed, read-only retrievers.
 * The model can never add, remove, or parameterise a retriever beyond the typed
 * invocations the deterministic planner emits. No arbitrary SQL is possible.
 */
const ALL: RetrieverDescriptor[] = [...PORTAL_RETRIEVERS, memoryRetriever];

export const RETRIEVER_REGISTRY: ReadonlyMap<DomainKey, RetrieverDescriptor> = new Map(ALL.map((d) => [d.domain, d]));

export function getRetriever(domain: DomainKey): RetrieverDescriptor | undefined {
  return RETRIEVER_REGISTRY.get(domain);
}
