import { isAllowedTaskUrl } from "../contracts/api";

export class NavigationPolicyError extends Error {
  readonly code = "url_not_allowed";

  constructor() {
    super("This address is not permitted for this browser session.");
    this.name = "NavigationPolicyError";
  }
}

export interface UrlPolicyOptions {
  /**
   * Also allow navigating between hosts of the same site: a host and its parent or subdomains,
   * such as google.com and www.google.com. The scheme and port must match an allowed origin.
   * Off by default.
   */
  sameSiteNavigation?: boolean;
}

/** Names and addresses that point into a private network or at the machine itself. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (host.includes(":")) {
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80") ||
      host.startsWith("::ffff:")
    );
  }
  return false;
}

/**
 * An https address on the public internet. Used for files a page loads (styles, scripts,
 * images, fonts) from other sites; never for navigation. The browser runs on the server, so
 * private and local addresses are refused to keep pages from probing the server's network.
 */
export function isPublicHttpsUrl(value: string): boolean {
  if (!isAllowedTaskUrl(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && !isPrivateHost(url.hostname);
}

/** True when one host is the other or a subdomain of it (www.google.com and google.com). */
export function isSameSiteHost(candidate: string, base: string): boolean {
  const a = candidate.toLowerCase();
  const b = base.toLowerCase();
  if (a === b) return true;
  // IP addresses and single-label names have no subdomains.
  const isIp = (host: string) => /^[\d.]+$/.test(host) || host.includes(":");
  if (isIp(a) || isIp(b)) return false;
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  // The shorter host must itself be a real domain (two labels or more), never a bare suffix.
  return shorter.includes(".") && longer.endsWith(`.${shorter}`);
}

/** Exact origins, plus same-site hosts when enabled. No credentials or wildcards. */
export function createUrlPolicy(
  allowedOrigins: readonly string[] = [],
  options: UrlPolicyOptions = {},
) {
  const origins = allowedOrigins.map((value) => {
    if (!isAllowedTaskUrl(value)) throw new NavigationPolicyError();
    const url = new URL(value);
    if (url.pathname !== "/" || url.search || url.hash) throw new NavigationPolicyError();
    return url;
  });
  const exact = new Set(origins.map((url) => url.origin));

  const allows = (value: string): boolean => {
    if (!isAllowedTaskUrl(value)) return false;
    const url = new URL(value);
    if (exact.has(url.origin)) return true;
    if (!options.sameSiteNavigation) return false;
    return origins.some(
      (allowed) =>
        allowed.protocol === url.protocol &&
        allowed.port === url.port &&
        isSameSiteHost(url.hostname, allowed.hostname),
    );
  };

  return {
    allows,
    assertAllowed(value: string): string {
      if (!allows(value)) throw new NavigationPolicyError();
      return new URL(value).href;
    },
  };
}
