/**
 * Shared, client-safe reaction config for project updates. Kept free of any
 * server imports so both client components and server queries can use it.
 *
 * The ❓ "Question" is intentionally NOT in this list — it isn't a stored emoji
 * reaction but a special follow-up request (callback/email) handled separately.
 */
export const UPDATE_REACTIONS: { emoji: string; label: string }[] = [
  { emoji: "👍", label: "Thumbs up" },
  { emoji: "❤️", label: "Love" },
  { emoji: "🎉", label: "Celebrate" },
  { emoji: "👀", label: "Eyes on it" },
];

export const UPDATE_REACTION_EMOJIS = UPDATE_REACTIONS.map((r) => r.emoji);

/** Aggregated reactions for a single update, plus the viewer's own choice. */
export interface ReactionSummary {
  /** emoji → count */
  counts: Record<string, number>;
  /** The current viewer's reaction emoji, if any. */
  mine: string | null;
}
