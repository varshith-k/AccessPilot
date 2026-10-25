import { describe, expect, it } from "vitest";
import {
  createUrlPolicy,
  isPrivateHost,
  isPublicHttpsUrl,
  isSameSiteHost,
} from "../../lib/browser/policy";

describe("isPrivateHost", () => {
  it.each([
    "localhost",
    "app.localhost",
    "printer.local",
    "db.internal",
    "router.home.arpa",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "[::1]",
    "[fd00::1]",
    "[fe80::1]",
    "[::ffff:127.0.0.1]",
  ])("treats %s as private", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(["example.com", "upload.wikimedia.org", "8.8.8.8", "172.32.0.1", "[2606:4700::1]"])(
    "treats %s as public",
    (host) => {
      expect(isPrivateHost(host)).toBe(false);
    },
  );
});

describe("isPublicHttpsUrl", () => {
  it("accepts public https files and refuses everything that could reach the server's network", () => {
    expect(isPublicHttpsUrl("https://github.githubassets.com/assets/app.css")).toBe(true);
    expect(isPublicHttpsUrl("https://fonts.gstatic.com/s/font.woff2")).toBe(true);
    for (const url of [
      "http://cdn.example.com/app.js",
      "https://localhost/app.js",
      "https://169.254.169.254/latest/meta-data",
      "https://192.168.0.10/admin",
      "https://2130706433/",
      "https://metadata.internal/",
      "https://user:pass@cdn.example.com/",
      "data:text/javascript,alert(1)",
      "javascript:alert(1)",
      "file:///etc/passwd",
    ]) {
      expect(isPublicHttpsUrl(url)).toBe(false);
    }
  });
});

describe("isSameSiteHost", () => {
  it.each([
    ["www.google.com", "google.com"],
    ["google.com", "www.google.com"],
    ["apply.scholarships.ufl.edu", "scholarships.ufl.edu"],
    ["example.org", "example.org"],
  ])("%s and %s are the same site", (a, b) => {
    expect(isSameSiteHost(a, b)).toBe(true);
  });

  it.each([
    ["login.ufl.edu", "scholarships.ufl.edu"],
    ["evilgoogle.com", "google.com"],
    ["google.com.evil.com", "google.com"],
    ["com", "google.com"],
    ["127.0.0.2", "127.0.0.1"],
    ["sub.127.0.0.1", "127.0.0.1"],
  ])("%s and %s are different sites", (a, b) => {
    expect(isSameSiteHost(a, b)).toBe(false);
  });
});

describe("createUrlPolicy with sameSiteNavigation", () => {
  it("follows www and subdomain hops only when enabled, with matching scheme and port", () => {
    const strict = createUrlPolicy(["https://google.com"]);
    const site = createUrlPolicy(["https://google.com"], { sameSiteNavigation: true });
    expect(strict.allows("https://www.google.com/")).toBe(false);
    expect(site.allows("https://www.google.com/")).toBe(true);
    expect(site.allows("https://accounts.google.com/signin")).toBe(true);
    expect(site.allows("http://www.google.com/")).toBe(false);
    expect(site.allows("https://www.google.com:8443/")).toBe(false);
    expect(site.allows("https://google.com.evil.com/")).toBe(false);
    expect(site.allows("https://youtube.com/")).toBe(false);
    expect(site.allows("javascript:alert(1)")).toBe(false);
  });

  it("keeps loopback origins exact", () => {
    const site = createUrlPolicy(["http://127.0.0.1:4000"], { sameSiteNavigation: true });
    expect(site.allows("http://127.0.0.1:4000/form")).toBe(true);
    expect(site.allows("http://127.0.0.1:4001/")).toBe(false);
    expect(site.allows("http://localhost:4000/")).toBe(false);
  });
});
