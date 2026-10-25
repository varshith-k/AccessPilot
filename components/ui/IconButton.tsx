import type { ButtonHTMLAttributes, ReactNode } from "react";
import { iconButtonStyles } from "./styles";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  children: ReactNode;
  /** Where the tooltip appears. */
  tooltipSide?: "top" | "bottom" | "right" | "left";
}

const TOOLTIP_SIDE: Record<NonNullable<IconButtonProps["tooltipSide"]>, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  // Anchored to the right edge so tooltips near the edge of the screen open inwards.
  bottom: "top-full right-0 mt-2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
};

/**
 * Icon-only button. The name comes from `label`; the tooltip repeats it visually on hover and
 * keyboard focus, and is hidden from assistive technology so it is never read twice. It is not
 * rendered until shown, so it never widens the page.
 */
export function IconButton({
  label,
  children,
  tooltipSide = "bottom",
  className = "",
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`group ${iconButtonStyles} ${className}`}
      {...rest}
    >
      {children}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute z-50 hidden animate-enter whitespace-nowrap rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-elevated group-hover:block group-focus-visible:block ${TOOLTIP_SIDE[tooltipSide]}`}
      >
        {label}
      </span>
    </button>
  );
}
