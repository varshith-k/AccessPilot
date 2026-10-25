"use client";

import { useId } from "react";
import type { ThemePreference } from "@/lib/client/theme";
import { MonitorIcon, MoonIcon, SunIcon } from "./ui/icons";
import { ModalDialog } from "./ui/ModalDialog";
import { ProfileSection } from "./ProfileSection";
import { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel";
import { buttonStyles } from "./ui/styles";

export interface SettingsDialogProps extends SettingsPanelProps {
  open: boolean;
  onClose(): void;
  theme: ThemePreference;
  onThemeChange(theme: ThemePreference): void;
}

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

/** A native radio group styled as a segmented control, so arrow keys work as expected. */
export function ThemeChooser({
  theme,
  onChange,
}: {
  theme: ThemePreference;
  onChange(theme: ThemePreference): void;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-semibold">Theme</legend>
      <div className="grid grid-cols-3 gap-1 rounded-control border border-border bg-subtle p-1">
        {THEME_OPTIONS.map(({ value, label, Icon }) => (
          <label
            key={value}
            className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium text-muted transition-colors duration-150 hover:text-fg has-[:checked]:bg-elevated has-[:checked]:text-fg has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus"
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={theme === value}
              onChange={() => onChange(value)}
              className="sr-only"
            />
            <Icon className="size-4 shrink-0" />
            <span className="whitespace-nowrap">{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsDialog({
  open,
  onClose,
  theme,
  onThemeChange,
  ...panel
}: SettingsDialogProps) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Settings"
      description="Saved in this browser."
      footer={
        <button type="button" onClick={onClose} className={buttonStyles.primary}>
          Done
        </button>
      }
    >
      <ThemeChooser theme={theme} onChange={onThemeChange} />
      <SettingsPanel {...panel} />
      <ProfileSection />
    </ModalDialog>
  );
}
