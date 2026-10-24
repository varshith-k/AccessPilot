import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;

export interface BrowserSessionOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
  launchTimeoutMs?: number;
  /** Optional installed Chromium channel, for example "chrome". */
  channel?: string;
}

/** One isolated, in-memory session. Reuse it for a task, then always close it. */
export class BrowserSession {
  private closePromise?: Promise<void>;

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly activePage: Page,
  ) {}

  static async create(options: BrowserSessionOptions = {}): Promise<BrowserSession> {
    const viewport = options.viewport ?? DEFAULT_VIEWPORT;
    for (const [name, value] of Object.entries({
      width: viewport.width,
      height: viewport.height,
      actionTimeoutMs: options.actionTimeoutMs ?? 10_000,
      navigationTimeoutMs: options.navigationTimeoutMs ?? 30_000,
      launchTimeoutMs: options.launchTimeoutMs ?? 30_000,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer.`);
      }
    }

    const browser = await chromium.launch({
      headless: options.headless ?? true,
      timeout: options.launchTimeoutMs ?? 30_000,
      ...(options.channel ? { channel: options.channel } : {}),
    });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({
        viewport: { ...viewport },
        deviceScaleFactor: 1,
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      context.setDefaultTimeout(options.actionTimeoutMs ?? 10_000);
      context.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? 30_000);
      const page = await context.newPage();
      return new BrowserSession(browser, context, page);
    } catch (error) {
      try {
        await context?.close();
      } catch {
        // Preserve the initialization failure; browser.close still runs below.
      }
      try {
        await browser.close();
      } catch {
        // Cleanup must not hide the original initialization failure.
      }
      throw error;
    }
  }

  get isClosed(): boolean {
    return Boolean(this.closePromise) || !this.browser.isConnected() || this.activePage.isClosed();
  }

  /** Internal server-side access. Navigation policy is added in step 3. */
  get page(): Page {
    if (this.isClosed) throw new Error("The browser session is closed.");
    return this.activePage;
  }

  /** Repeated/concurrent calls share cleanup and do not launch another browser. */
  close(): Promise<void> {
    this.closePromise ??= this.dispose();
    return this.closePromise;
  }

  private async dispose(): Promise<void> {
    try {
      await this.context.close();
    } finally {
      await this.browser.close();
    }
  }
}

export const createBrowserSession = BrowserSession.create;
