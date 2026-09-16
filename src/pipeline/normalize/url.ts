const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "source",
  "s",
  "igshid",
  "_hsenc",
  "_hsmi",
  "oly_enc_id",
  "cmpid",
]);

/**
 * Canonical URL used for cross-source matching: same article from a company
 * blog, from Hacker News, and from an X post should all collapse to one key.
 */
export function canonicalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  u.protocol = "https:";
  u.hash = "";
  u.hostname = u.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/^m\./, "");
  if (u.hostname === "mobile.twitter.com" || u.hostname === "twitter.com") u.hostname = "x.com";

  // arXiv: strip version suffix and unify abs/pdf/html
  if (u.hostname === "arxiv.org" || u.hostname === "export.arxiv.org") {
    u.hostname = "arxiv.org";
    const m = u.pathname.match(/\/(?:abs|pdf|html)\/([\w.\-/]+?)(?:v\d+)?(?:\.pdf)?\/?$/);
    if (m) u.pathname = `/abs/${m[1]}`;
    u.search = "";
  }

  // Drop tracking params, keep the rest sorted for stability.
  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    if (TRACKING_PARAMS.has(k.toLowerCase()) || k.toLowerCase().startsWith("utm_")) continue;
    kept.push([k, v]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  u.search = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";

  // Trailing slash and default ports
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  if (u.pathname.endsWith("/index.html"))
    u.pathname = u.pathname.slice(0, -"/index.html".length) || "/";
  return u.toString();
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
