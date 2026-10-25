/**
 * Shared class names, so every control in the app looks and behaves the same. Buttons are at
 * least 44px tall (40px for compact icon buttons), well above the 24px WCAG 2.2 minimum.
 */
const buttonBase =
  "inline-flex min-h-11 max-w-full select-none flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-control border px-4 py-2 text-center text-sm font-medium break-words transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export const buttonStyles = {
  primary: `${buttonBase} border-accent bg-accent text-on-accent shadow-sm hover:brightness-110`,
  secondary: `${buttonBase} border-border-strong/60 bg-elevated text-fg hover:bg-hover`,
  ghost: `${buttonBase} border-transparent bg-transparent text-fg hover:bg-hover`,
  danger: `${buttonBase} border-danger bg-danger text-on-danger shadow-sm hover:brightness-110`,
} as const;

/** Square icon-only button. Always pair with an accessible name (aria-label). */
export const iconButtonStyles =
  "relative inline-flex size-10 shrink-0 items-center justify-center rounded-control border border-transparent text-muted transition-colors duration-150 hover:bg-hover hover:text-fg aria-pressed:bg-hover aria-pressed:text-fg disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[18px]";

export const inputStyles =
  "block w-full rounded-control border border-border-strong bg-elevated px-3.5 py-2.5 text-[15px] text-fg placeholder:text-muted transition-[border-color,box-shadow] duration-150 hover:border-fg/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60";

export const labelStyles = "block text-[13px] font-medium text-fg";
export const hintStyles = "text-[13px] leading-5 text-muted";
export const errorTextStyles = "flex items-start gap-1.5 text-[13px] font-medium text-danger";

/** Small uppercase section label used above cards and lists. */
export const eyebrowStyles = "text-xs font-medium uppercase tracking-[0.08em] text-muted";

/** Keyboard shortcut hints are noise on touch screens; aria-keyshortcuts still exposes them. */
export const shortcutHint = "[@media(pointer:coarse)]:hidden";

export const kbdStyles =
  "inline-flex min-w-6 items-center justify-center rounded-md border border-border bg-subtle px-1.5 py-0.5 font-mono text-xs font-medium text-fg";
