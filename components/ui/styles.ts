/** Shared class names. Every button is at least 44px tall, well above the 24px minimum. */
const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border-2 px-4 py-2 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-60";

export const buttonStyles = {
  primary: `${buttonBase} border-accent bg-accent text-on-accent hover:brightness-110`,
  secondary: `${buttonBase} border-border bg-bg text-fg hover:bg-surface`,
  danger: `${buttonBase} border-danger bg-danger text-on-danger hover:brightness-110`,
} as const;

export const inputStyles =
  "block w-full rounded-md border-2 border-border bg-bg px-3 py-2 text-base text-fg placeholder:text-muted aria-[invalid=true]:border-danger";

export const panelStyles = "rounded-lg border border-border bg-surface p-4";
