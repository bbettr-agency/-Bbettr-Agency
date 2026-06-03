import * as React from "react";
import { Slot } from "@/components/ui/slot";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-brand-500 text-white shadow-brand hover:bg-brand-600 focus-visible:ring-brand-500",
  secondary:
    "bg-ink-900 text-white hover:bg-ink-800 focus-visible:ring-ink-900",
  outline:
    "border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 hover:border-ink-300 focus-visible:ring-brand-500",
  ghost:
    "text-ink-600 hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-ink-300",
  danger:
    "bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-500",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-10 w-10",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      asChild = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const classes = cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-xl font-semibold transition-all duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
      variantStyles[variant],
      sizeStyles[size],
      className
    );

    // When rendering `asChild` (e.g. a Link), Slot must receive exactly ONE
    // valid React element. Injecting the loading spinner here would make
    // `children` an array, so the spinner is button-only. Likewise `disabled`
    // is not a valid prop on an anchor, so we only pass it to a real <button>.
    if (asChild) {
      return (
        <Comp ref={ref} className={classes} {...props}>
          {children}
        </Comp>
      );
    }

    return (
      <Comp ref={ref} className={classes} disabled={disabled || loading} {...props}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    );
  }
);
Button.displayName = "Button";
