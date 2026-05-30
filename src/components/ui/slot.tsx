import * as React from "react";

/**
 * Minimal `asChild` slot. Merges the parent's props/className onto its single
 * child element so components like Button can render as a Link without an
 * extra DOM node. A lightweight stand-in for Radix's Slot.
 */
export const Slot = React.forwardRef<HTMLElement, { children?: React.ReactNode } & Record<string, unknown>>(
  ({ children, ...props }, ref) => {
    if (!React.isValidElement(children)) return null;

    const child = children as React.ReactElement<Record<string, unknown>>;
    const childProps = child.props;

    return React.cloneElement(child, {
      ...props,
      ...childProps,
      className: [props.className, childProps.className].filter(Boolean).join(" "),
      ref,
    } as Record<string, unknown>);
  }
);
Slot.displayName = "Slot";
