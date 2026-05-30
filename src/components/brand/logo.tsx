import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showWordmark?: boolean;
  variant?: "default" | "light";
}

/**
 * Bbettr Agency logo lockup. The mark is a rounded "B" tile in the brand
 * gradient; the wordmark renders "Bbettr" with an accented final letter.
 */
export function Logo({
  className,
  showWordmark = true,
  variant = "default",
}: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-brand">
        <span className="font-display text-lg font-extrabold leading-none">B</span>
      </span>
      {showWordmark && (
        <span
          className={cn(
            "font-display text-lg font-extrabold tracking-tight",
            variant === "light" ? "text-white" : "text-ink-900"
          )}
        >
          Bbettr
          <span className="text-brand-500">.</span>
        </span>
      )}
    </span>
  );
}
