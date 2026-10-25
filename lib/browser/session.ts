import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createUrlPolicy, isPublicHttpsUrl, NavigationPolicyError } from "./policy";

export const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;

export interface BrowserSessionOptions {
  /** Exact trusted demo origins. Empty by default: all network access is denied. */
  allowedOrigins?: readonly string[];
  headless?: boolean;
  viewport?: { width: number; height: number };
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
  launchTimeoutMs?: number;
  /** Optional installed Chromium channel, for example "chrome". */
  channel?: string;
  /** If the channel can't be launched, use the bundled Chromium instead of failing. */
  channelFallback?: boolean;
  /** Allow navigating to same-site hosts (google.com to www.google.com). Off by default. */
  sameSiteNavigation?: boolean;
  /**
   * Let pages load their own files (styles, scripts, images, fonts, and other GET requests) from
   * other public https sites, so real pages render as people see them. Navigation, frames,
   * popups and every non-GET request stay limited to the allowed origins, and private or local
   * addresses are always refused. Off by default.
   */
  thirdPartySubresources?: boolean;
}

/** One isolated, in-memory session. Reuse it for a task, then always close it. */
export class BrowserSession {
  private closePromise?: Promise<void>;
  /** Set the moment the page leaves the network policy, before Chromium finishes closing it. */
  private policyClose = { requested: false };
  private actionPolicy = { enabled: false, approved: false, blocked: false, stopped: false };

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly activePage: Page,
    private readonly policy: ReturnType<typeof createUrlPolicy>,
    private readonly redirects: Map<string, string>,
  ) {}

  static async create(options: BrowserSessionOptions = {}): Promise<BrowserSession> {
    const policy = createUrlPolicy(options.allowedOrigins, {
      sameSiteNavigation: options.sameSiteNavigation ?? false,
    });
    const allowsSubresource = (url: string, method: string) =>
      options.thirdPartySubresources === true &&
      ["GET", "HEAD"].includes(method) &&
      isPublicHttpsUrl(url);
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

    const launch = (channel?: string) =>
      chromium.launch({
        headless: options.headless ?? true,
        timeout: options.launchTimeoutMs ?? 30_000,
        ...(channel ? { channel } : {}),
      });
    let browser: Browser;
    try {
      browser = await launch(options.channel);
    } catch (error) {
      // An installed browser channel (Google Chrome) isn't available on every machine, such as CI
      // or a container. Fall back to Playwright's bundled Chromium rather than failing the task.
      if (!options.channel || !options.channelFallback) throw error;
      browser = await launch();
    }
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
      const primaryPage = await context.newPage();
      const actionPolicy = { enabled: false, approved: false, blocked: false, stopped: false };
      const redirects = new Map<string, string>();
      const policyClose = { requested: false };
      await context.route("**/*", async (route) => {
        try {
          const request = route.request();
          if (actionPolicy.stopped) {
            await route.abort("blockedbyclient");
            return;
          }
          const isWrite = !["GET", "HEAD", "OPTIONS"].includes(request.method());
          // Background writes to other sites (analytics beacons, telemetry) are never allowed and
          // can't be the task's submission, so drop them without flagging the action.
          if (isWrite && !request.isNavigationRequest() && !policy.allows(request.url())) {
            await route.abort("blockedbyclient");
            return;
          }
          if (actionPolicy.enabled && !actionPolicy.approved && isWrite) {
            actionPolicy.blocked = true;
            await route.abort("blockedbyclient");
            return;
          }
          // Reject popup requests before they reach the network. Documents (pages, frames) must
          // be on an allowed origin; a page's own files may also come from public sites.
          const isDocument = request.isNavigationRequest();
          const permitted =
            policy.allows(request.url()) ||
            (!isDocument && allowsSubresource(request.url(), request.method()));
          if (!permitted || (isDocument && request.frame().page() !== primaryPage)) {
            await route.abort("blockedbyclient");
            return;
          }
          // Never let Chromium follow redirects itself: later hops bypass routing.
          const response = await route.fetch({
            maxRedirects: 0,
            timeout: options.navigationTimeoutMs ?? 30_000,
          });
          try {
            const location = response.headers()["location"];
            if ([301, 302, 303, 307, 308].includes(response.status()) && location) {
              if (
                [307, 308].includes(response.status()) &&
                !["GET", "HEAD"].includes(request.method())
              ) {
                actionPolicy.blocked = true;
                await route.abort("blockedbyclient");
                return;
              }
              if (request.isNavigationRequest() && request.frame() === primaryPage?.mainFrame()) {
                redirects.set(request.url(), new URL(location, request.url()).href);
                // Finish this navigation without a redirect or Chromium error page.
                // navigate() will validate and open the next hop explicitly.
                await route.fulfill({
                  status: 200,
                  contentType: "text/html",
                  body: "<!doctype html><title>Navigation paused</title>",
                });
                return;
              }
              await route.abort("blockedbyclient");
              return;
            }
            await route.fulfill({ response });
          } finally {
            await response.dispose();
          }
        } catch {
          // Network failure or shutdown must fail the request, never leave it pending.
          await route.abort("failed").catch(() => {});
        }
      });
      // Demo sessions do not need WebSockets or additional windows.
      await context.routeWebSocket("**/*", (socket) => socket.close());
      const page = primaryPage;
      page.on("framenavigated", (frame) => {
        // Non-network destinations (for example about:blank) do not hit routing.
        if (frame === page.mainFrame() && !policy.allows(frame.url())) {
          // Closing can take seconds on a busy machine; treat the session as closed right away
          // so nothing can act on the disallowed page in the meantime.
          policyClose.requested = true;
          void page.close().catch(() => {});
        }
      });
      context.on("page", (opened) => {
        if (opened !== page) void opened.close().catch(() => {});
      });
      const session = new BrowserSession(browser, context, page, policy, redirects);
      session.actionPolicy = actionPolicy;
      session.policyClose = policyClose;
      return session;
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
    return (
      Boolean(this.closePromise) ||
      this.policyClose.requested ||
      !this.browser.isConnected() ||
      this.activePage.isClosed()
    );
  }

  /** Internal server-side access; callers must not expose this object to models. */
  get page(): Page {
    if (this.isClosed) throw new Error("The browser session is closed.");
    return this.activePage;
  }

  async navigate(url: string): Promise<{ url: string; status: number | null }> {
    let destination = this.policy.assertAllowed(url);
    for (let hop = 0; hop <= 10; hop++) {
      const requestUrl = new URL(destination);
      requestUrl.hash = "";
      const key = requestUrl.href;
      this.redirects.clear();
      try {
        const response = await this.page.goto(destination, { waitUntil: "domcontentloaded" });
        const redirect = this.redirects.get(key);
        this.redirects.clear();
        if (redirect) {
          destination = this.policy.assertAllowed(redirect);
          continue;
        }
        if (!this.policy.allows(this.page.url())) throw new NavigationPolicyError();
        if (response && !response.ok()) {
          throw new Error(`The permitted website returned HTTP ${response.status()}.`);
        }
        return { url: this.page.url(), status: response?.status() ?? null };
      } catch (error) {
        const next = this.redirects.get(key);
        this.redirects.clear();
        if (!next) throw error;
        destination = this.policy.assertAllowed(next);
      }
    }
    throw new Error("The website exceeded the limit of 10 redirects.");
  }

  /** Trusted controller hooks; never expose these to model-generated code. */
  setActionPermission(approved: boolean): void {
    this.actionPolicy.enabled = true;
    this.actionPolicy.approved = approved;
    this.actionPolicy.blocked = false;
  }

  get blockedMutation(): boolean {
    return this.actionPolicy.blocked;
  }

  assertUrlAllowed(url: string): string {
    return this.policy.assertAllowed(url);
  }

  async followPendingRedirect(): Promise<void> {
    const url = new URL(this.page.url());
    url.hash = "";
    const redirect = this.redirects.get(url.href);
    this.redirects.clear();
    if (redirect) await this.navigate(redirect);
  }

  /** Repeated/concurrent calls share cleanup and do not launch another browser. */
  close(): Promise<void> {
    this.actionPolicy.stopped = true;
    this.actionPolicy.approved = false;
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
