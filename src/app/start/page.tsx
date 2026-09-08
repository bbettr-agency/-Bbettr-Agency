import { IntakeIntro } from "@/components/prospect/intake-intro";

/**
 * Generic public intake entry (P2-A). Renders the intro only — NO database row
 * is created on GET. The secure draft-creation boundary (completing "Your
 * business" → Turnstile-verified insert → tokenised /start/<token>) arrives in
 * P2-C/D.
 */
export default function StartPage() {
  return <IntakeIntro />;
}
