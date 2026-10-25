"use client";

import { useId, useState } from "react";
import { IMAGE_DATA_URL_PATTERN } from "@/lib/contracts";
import type { ScreenshotEntry } from "@/lib/client/taskState";
import { BrowserIcon, ChevronLeftIcon, ChevronRightIcon, GlobeIcon } from "./ui/icons";
import { buttonStyles } from "./ui/styles";

export interface BrowserPreviewProps {
  screenshots: ScreenshotEntry[];
  /** The address the task started on, shown in the window frame. */
  url?: string | null | undefined;
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Latest screenshot of the controlled browser, with history. Only the first appearance fades
 * in; switching screenshots is instant, so it behaves the same with reduced motion.
 */
export function BrowserPreview({ screenshots, url }: BrowserPreviewProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  // null means "follow the latest"; a number pins the view to that screenshot.
  const [pinned, setPinned] = useState<number | null>(null);
  const count = screenshots.length;
  const index = pinned === null ? count - 1 : Math.min(pinned, count - 1);
  const current = index >= 0 ? screenshots[index] : undefined;
  const following = pinned === null || index === count - 1;

  const show = (next: number) => {
    if (next < 0 || next > count - 1) return;
    setPinned(next >= count - 1 ? null : next);
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="sr-only">
        Browser preview
      </h2>
      <div className="overflow-hidden rounded-card border border-border bg-elevated shadow-elevated">
        <div className="flex items-center gap-3 border-b border-border bg-subtle px-3 py-2">
          <span aria-hidden="true" className="flex gap-1.5">
            <i className="size-2.5 rounded-full bg-border-strong/40" />
            <i className="size-2.5 rounded-full bg-border-strong/40" />
            <i className="size-2.5 rounded-full bg-border-strong/40" />
          </span>
          <p className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-elevated px-2.5 py-1 text-xs text-muted">
            <GlobeIcon className="size-3.5 shrink-0" />
            <span className="truncate font-mono">
              {url ? (
                <>
                  <span className="sr-only">Address: </span>
                  {displayUrl(url)}
                </>
              ) : (
                "No page open"
              )}
            </span>
          </p>
        </div>

        {current === undefined ? (
          <div className="flex aspect-[16/10] flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-border bg-subtle text-muted">
              <BrowserIcon className="size-5" />
            </span>
            <p className="max-w-xs text-sm text-muted">
              No screenshots yet. Once AccessPilot starts working, this shows what the browser
              window looks like after each step, with a description.
            </p>
          </div>
        ) : (
          <figure className="animate-enter">
            {IMAGE_DATA_URL_PATTERN.test(current.imageDataUrl) ? (
              // Screenshots are inline data URLs; next/image adds nothing for them.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.imageDataUrl}
                alt={current.alt}
                className="block h-auto w-full bg-bg"
              />
            ) : (
              <p className="p-4 text-sm">
                This screenshot could not be shown. Description: {current.alt}
              </p>
            )}
            <figcaption className="space-y-1 border-t border-border px-4 py-3">
              <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                Screenshot {index + 1} of {count}
                {current.step > 0 ? `, from step ${current.step}` : ", before the first step"}
                {following ? " (latest)" : ""}
              </span>
              <span className="block text-sm text-muted">{current.alt}</span>
            </figcaption>
          </figure>
        )}
      </div>

      {current !== undefined && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Screenshot history">
          <button
            type="button"
            onClick={() => show(index - 1)}
            // aria-disabled keeps focus on the button at the first screenshot.
            aria-disabled={index <= 0}
            className={`${buttonStyles.secondary} min-h-10 px-3`}
          >
            <ChevronLeftIcon />
            Previous screenshot
          </button>
          <button
            type="button"
            onClick={() => show(index + 1)}
            aria-disabled={index >= count - 1}
            className={`${buttonStyles.secondary} min-h-10 px-3`}
          >
            Next screenshot
            <ChevronRightIcon />
          </button>
          {!following && (
            <button
              type="button"
              onClick={() => setPinned(null)}
              className={`${buttonStyles.ghost} min-h-10 px-3 text-accent`}
            >
              Show latest
            </button>
          )}
        </div>
      )}
    </section>
  );
}
