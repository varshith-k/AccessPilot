import { render, screen, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { StatusAnnouncer } from "@/components/StatusAnnouncer";
import { AnnouncerProvider } from "@/hooks/useAnnouncer";

function Providers({ children }: { children: ReactNode }) {
  return (
    <AnnouncerProvider>
      {children}
      <StatusAnnouncer />
    </AnnouncerProvider>
  );
}

/** Renders inside the announcer, as components are in the app. */
export function renderWithAnnouncer(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options });
}

/** Text of a live region without the zero-width marker. */
export function liveText(priority: "polite" | "assertive"): string {
  return screen.getByTestId(`live-${priority}`).textContent?.replace(/​/g, "") ?? "";
}
