import type { ReactNode, SVGProps } from "react";

/**
 * Minimal stroke icons (24px grid, 1.75 stroke). Always decorative: the control or text next to
 * them carries the meaning, so they are hidden from assistive technology.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function icon(paths: ReactNode) {
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {paths}
      </svg>
    );
  }
  return Icon;
}

export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const PanelLeftIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </>,
);
export const PanelRightIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M15 4v16" />
  </>,
);
export const SettingsIcon = icon(
  <>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </>,
);
export const KeyboardIcon = icon(
  <>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
  </>,
);
export const SunIcon = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </>,
);
export const MoonIcon = icon(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />);
export const MonitorIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </>,
);
export const MicIcon = icon(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </>,
);
export const StopIcon = icon(<rect x="6" y="6" width="12" height="12" rx="2" />);
export const ArrowUpIcon = icon(<path d="M12 19V5M6 11l6-6 6 6" />);
export const GlobeIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
  </>,
);
export const CheckIcon = icon(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const XIcon = icon(<path d="M6 6l12 12M18 6 6 18" />);
export const AlertIcon = icon(
  <>
    <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 16.5h.01" />
  </>,
);
export const InfoIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5h.01" />
  </>,
);
export const CopyIcon = icon(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
  </>,
);
export const ChevronLeftIcon = icon(<path d="m15 6-6 6 6 6" />);
export const ChevronRightIcon = icon(<path d="m9 6 6 6-6 6" />);
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);
export const HandIcon = icon(
  <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5V4a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.8-2.4L4.6 15.3a1.5 1.5 0 0 1 2.3-1.9L8 14.5" />,
);
export const ShieldIcon = icon(
  <>
    <path d="M12 3 5 6v5.5c0 4.3 2.9 8 7 9.5 4.1-1.5 7-5.2 7-9.5V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </>,
);
export const MessageIcon = icon(
  <path d="M5 18.5 3.5 21V6.5A2.5 2.5 0 0 1 6 4h12a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 18 18H6Z" />,
);
export const BrowserIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M3 9h18M6.5 6.5h.01M9 6.5h.01" />
  </>,
);
export const HomeIcon = icon(
  <>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1Z" />
  </>,
);
export const LoaderIcon = icon(<path d="M12 3a9 9 0 1 0 9 9" />);
export const VolumeIcon = icon(
  <>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </>,
);

/** The AccessPilot mark: a compass needle in a rounded square. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-[9px] bg-fg text-bg ${className}`}
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" focusable="false">
        <path d="M12 3.5 17 20l-5-3.2L7 20Z" fill="currentColor" />
      </svg>
    </span>
  );
}

/** Spinning indicator. The rotation stops under prefers-reduced-motion; the icon stays. */
export function Spinner({ className = "size-4" }: { className?: string }) {
  return <LoaderIcon className={`${className} animate-spin motion-reduce:animate-none`} />;
}
