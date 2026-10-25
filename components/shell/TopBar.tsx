"use client";

import { memo } from "react";
import type { ThemePreference } from "@/lib/client/theme";
import type { TaskStatus } from "@/lib/client/taskState";
import {
  KeyboardIcon,
  LogoMark,
  MonitorIcon,
  MoonIcon,
  PanelRightIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
} from "../ui/icons";
import { IconButton } from "../ui/IconButton";
import { StatusBadge } from "../ui/StatusBadge";

export interface TopBarProps {
  title: string;
  status: TaskStatus;
  declined?: boolean;
  /** "demo" when the scripted mock client is in use, "live" for the real backend. */
  mode: "demo" | "live";
  theme: ThemePreference;
  onThemeChange(theme: ThemePreference): void;
  onNewTask(): void;
  newTaskBlocked: boolean;
  onOpenSettings(): void;
  onOpenShortcuts(): void;
  browserPanelId: string;
  browserPanelOpen: boolean;
  onToggleBrowserPanel(): void;
}

const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const THEME_NAME: Record<ThemePreference, string> = {
  system: "system",
  light: "light",
  dark: "dark",
};

export const TopBar = memo(function TopBar({
  title,
  status,
  declined,
  mode,
  theme,
  onThemeChange,
  onNewTask,
  newTaskBlocked,
  onOpenSettings,
  onOpenShortcuts,
  browserPanelId,
  browserPanelOpen,
  onToggleBrowserPanel,
}: TopBarProps) {
  const ThemeIcon = theme === "light" ? SunIcon : theme === "dark" ? MoonIcon : MonitorIcon;
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-bg px-3 sm:gap-2 sm:px-4">
      <LogoMark className="size-7 lg:hidden" />
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-1.5 lg:pl-0">
        <h1 className="shrink-0 text-sm font-semibold tracking-tight">AccessPilot</h1>
        <span aria-hidden="true" className="text-border-strong max-sm:hidden">
          /
        </span>
        <p className="truncate text-sm text-muted max-sm:hidden" title={title}>
          {title}
        </p>
      </div>

      <StatusBadge status={status} declined={declined} className="max-sm:hidden" />
      <span
        className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium max-md:hidden ${
          mode === "live" ? "border-success/30 text-success" : "border-border text-muted"
        }`}
        title={
          mode === "live"
            ? "Connected to the AccessPilot backend and a real browser."
            : "Scripted demo. No real browser is being controlled."
        }
      >
        <i
          aria-hidden="true"
          className={`size-1.5 rounded-full ${mode === "live" ? "bg-success" : "bg-muted"}`}
        />
        {mode === "live" ? "Live browser" : "Demo mode"}
      </span>

      <div className="flex shrink-0 items-center">
        <IconButton
          label="New task"
          onClick={onNewTask}
          aria-disabled={newTaskBlocked || undefined}
          className="lg:hidden aria-disabled:opacity-50"
        >
          <PlusIcon />
        </IconButton>
        <IconButton
          label={browserPanelOpen ? "Hide browser panel" : "Show browser panel"}
          aria-expanded={browserPanelOpen}
          aria-controls={browserPanelId}
          onClick={onToggleBrowserPanel}
          className="max-lg:hidden"
        >
          <PanelRightIcon />
        </IconButton>
        <IconButton
          label={`Theme: ${THEME_NAME[theme]}. Switch to ${THEME_NAME[NEXT_THEME[theme]]}`}
          onClick={() => onThemeChange(NEXT_THEME[theme])}
        >
          <ThemeIcon />
        </IconButton>
        <IconButton label="Settings" onClick={onOpenSettings} className="lg:hidden">
          <SettingsIcon />
        </IconButton>
        <IconButton
          label="Keyboard shortcuts"
          aria-keyshortcuts="?"
          onClick={onOpenShortcuts}
          className="lg:hidden"
        >
          <KeyboardIcon />
        </IconButton>
      </div>
    </header>
  );
});
