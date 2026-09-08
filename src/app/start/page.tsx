import { IntakeFlow } from "@/components/prospect/intake-flow";

/**
 * Generic public intake entry (P2-D). Renders the interactive flow starting at
 * the intro — NO database row is created on GET. The secure draft-creation
 * boundary fires only after a valid "Your business" step (Turnstile-verified
 * service-role insert), which then transitions the URL to /start/<token>.
 */
export default function StartPage() {
  return <IntakeFlow mode="generic" />;
}
