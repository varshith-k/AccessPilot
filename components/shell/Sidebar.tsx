"use client";

import { memo } from "react";
import type { ReactNode } from "react";
import type { TaskStatus } from "@/lib/client/taskState";
import {
  HomeIcon,
  KeyboardIcon,
  LogoMark,
  PanelLeftIcon,
  PlusIcon,
  SettingsIcon,
} from "../ui/icons";
import { IconButton } from "../ui/IconButton";
import { StatusBadge } from "../ui/StatusBadge";
import { eyebrowStyles } from "../ui/styles";

export interface SidebarProps {
  id: string;
  collapsed: boolean;
  onToggleCollapsed(): void;
  onNewTask(): void;
  /** True while a task runs: a new task needs the current one stopped first. */
  newTaskBlocked: boolean;
  onOpenSettings(): void;
  onOpenShortcuts(): void;
  currentTask: { goal: string; url: string; status: TaskStatus; declined: boolean } | null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  current?: boolean;
  href?: string;
  onClick?: () => void;
  shortcut?: string;
}

const navItemStyles =
  "group relative flex min-h-10 w-full items-center gap-3 rounded-control px-3 text-sm font-medium text-muted transition-colors duration-150 hover:bg-hover hover:text-fg aria-[current=page]:bg-hover aria-[current=page]:text-fg [&_svg]:size-[18px] [&_svg]:shrink-0";

function NavItem({ icon, label, collapsed, current, href, onClick, shortcut }: NavItemProps) {
  const content = (
    <>
      {icon}
      <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
      {collapsed && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 animate-enter whitespace-nowrap rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-elevated group-hover:block group-focus-visible:block"
        >
          {label}
        </span>
      )}
    </>
  );
  const className = `${navItemStyles} ${collapsed ? "justify-center px-0" : ""}`;
  if (href !== undefined) {
    return (
      <a href={href} aria-current={current ? "page" : undefined} className={className}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-keyshortcuts={shortcut} className={className}>
      {content}
    </button>
  );
}

/** Desktop navigation. Below the lg breakpoint the top bar offers the same actions. */
export const Sidebar = memo(function Sidebar({
  id,
  collapsed,
  onToggleCollapsed,
  onNewTask,
  newTaskBlocked,
  onOpenSettings,
  onOpenShortcuts,
  currentTask,
}: SidebarProps) {
  return (
    <aside
      id={id}
      aria-label="Sidebar"
      className={`hidden shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 ease-out lg:flex ${collapsed ? "w-[4.25rem]" : "w-64"}`}
    >
      <div
        className={`flex h-14 items-center gap-2.5 px-4 ${collapsed ? "justify-center px-0" : ""}`}
      >
        <LogoMark />
        {!collapsed && (
          <span className="truncate text-[15px] font-semibold tracking-tight">AccessPilot</span>
        )}
      </div>

      <div className={`px-3 pb-2 pt-1 ${collapsed ? "px-3.5" : ""}`}>
        <button
          type="button"
          onClick={onNewTask}
          aria-disabled={newTaskBlocked || undefined}
          aria-label={collapsed ? "New task" : undefined}
          className={`flex min-h-10 w-full items-center gap-2.5 rounded-control border border-border-strong/50 bg-elevated text-sm font-medium shadow-sm transition-colors duration-150 hover:bg-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:size-4 ${collapsed ? "justify-center" : "px-3"}`}
        >
          <PlusIcon />
          {!collapsed && "New task"}
        </button>
      </div>

      <nav aria-label="Primary" className="space-y-0.5 px-3 py-2">
        <NavItem icon={<HomeIcon />} label="Workspace" href="#main" current collapsed={collapsed} />
        <NavItem
          icon={<SettingsIcon />}
          label="Settings"
          onClick={onOpenSettings}
          collapsed={collapsed}
        />
        <NavItem
          icon={<KeyboardIcon />}
          label="Keyboard shortcuts"
          onClick={onOpenShortcuts}
          shortcut="?"
          collapsed={collapsed}
        />
      </nav>

      {!collapsed && currentTask && (
        <div className="mt-2 space-y-2 px-3">
          <p className={`px-3 ${eyebrowStyles}`}>Current task</p>
          <div className="space-y-2 rounded-control border border-border bg-elevated p-3">
            <p className="line-clamp-3 text-sm font-medium leading-5">{currentTask.goal}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-muted">
                {hostOf(currentTask.url)}
              </span>
              <StatusBadge
                status={currentTask.status}
                declined={currentTask.declined}
                className="h-6 px-2 text-[11px]"
              />
            </div>
          </div>
        </div>
      )}

      <div className="mt-auto space-y-2 p-3">
        <div className={collapsed ? "flex justify-center" : ""}>
          <IconButton
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls={id}
            onClick={onToggleCollapsed}
            tooltipSide="right"
          >
            <PanelLeftIcon />
          </IconButton>
        </div>
      </div>
    </aside>
  );
});
