"use client";

import { useId, useState } from "react";
import { IMAGE_DATA_URL_PATTERN } from "@/lib/contracts";
import type { ScreenshotEntry } from "@/lib/client/taskState";
import { buttonStyles } from "./ui/styles";

export interface BrowserPreviewProps {
  screenshots: ScreenshotEntry[];
}

/**
 * Latest screenshot of the controlled browser, with history. No transitions are used, so it
 * behaves the same with or without prefers-reduced-motion.
 */
export function BrowserPreview({ screenshots }: BrowserPreviewProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  // null means "follow the latest"; a number pins the view to that screenshot.
  const [pinned, setPinned] = useState<number | null>(null);
  const count = screenshots.length;
  const index = pinned === null ? count - 1 : Math.min(pinned, count - 1);
  const current = index >= 0 ? screenshots[index] : undefined;
  const following = pinned === null || index === count - 1;

  const show = (next: number) => setPinned(next >= count - 1 ? null : next);

  return (
    <section className="space-y-3">
      <h2 id={headingId} className="text-xl font-bold">
        Browser preview
      </h2>
      {current === undefined ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-muted">
          No screenshots yet. Once AccessPilot starts working, this shows what the browser window
          looks like after each step, with a description.
        </p>
      ) : (
        <>
          <figure className="space-y-2">
            {IMAGE_DATA_URL_PATTERN.test(current.imageDataUrl) ? (
              // Screenshots are inline data URLs; next/image adds nothing for them.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.imageDataUrl}
                alt={current.alt}
                className="h-auto w-full rounded-md border border-border bg-bg"
              />
            ) : (
              <p className="rounded-md border border-border p-4">
                This screenshot could not be shown. Description: {current.alt}
              </p>
            )}
            <figcaption className="space-y-1">
              <span className="block font-semibold">
                Screenshot {index + 1} of {count}
                {current.step > 0 ? `, from step ${current.step}` : ", before the first step"}
                {following ? " (latest)" : ""}
              </span>
              <span className="block text-sm">{current.alt}</span>
            </figcaption>
          </figure>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Screenshot history">
            <button
              type="button"
              onClick={() => show(index - 1)}
              disabled={index <= 0}
              className={buttonStyles.secondary}
            >
              Previous screenshot
            </button>
            <button
              type="button"
              onClick={() => show(index + 1)}
              disabled={index >= count - 1}
              className={buttonStyles.secondary}
            >
              Next screenshot
            </button>
            {!following && (
              <button
                type="button"
                onClick={() => setPinned(null)}
                className={buttonStyles.secondary}
              >
                Show latest
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
