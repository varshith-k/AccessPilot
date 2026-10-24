import { isAllowedTaskUrl } from "../contracts/api";

export class NavigationPolicyError extends Error {
  readonly code = "url_not_allowed";

  constructor() {
    super("This address is not permitted for this browser session.");
    this.name = "NavigationPolicyError";
  }
}

/** Exact origins only: no implicit subdomains, ports, credentials, or wildcards. */
export function createUrlPolicy(allowedOrigins: readonly string[] = []) {
  const origins = new Set(
    allowedOrigins.map((value) => {
      if (!isAllowedTaskUrl(value)) throw new NavigationPolicyError();
      const url = new URL(value);
      if (url.pathname !== "/" || url.search || url.hash) throw new NavigationPolicyError();
      return url.origin;
    }),
  );

  const allows = (value: string): boolean =>
    isAllowedTaskUrl(value) && origins.has(new URL(value).origin);

  return {
    allows,
    assertAllowed(value: string): string {
      if (!allows(value)) throw new NavigationPolicyError();
      return new URL(value).href;
    },
  };
}
