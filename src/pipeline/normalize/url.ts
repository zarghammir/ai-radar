/**
 * Parameters dropped on every host.
 *
 * A deliberate trade, not an oversight: each of these is a conventional
 * campaign or referrer tag, so two URLs differing only by one are the same
 * page. `source` and `ref` are the widest of them and would collapse a site
 * that used either as a real query parameter. That is accepted; anything
 * host-specific belongs in HOST_TRACKING_PARAMS below instead, because a rule
 * that discards information for a whole host loses pages rather than noise.
 *
 * Everything else canonicalizeUrl removes is a true equivalence rather than a
 * discard: scheme, fragment, a www or m prefix, a trailing slash, index.html.
 */
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
  "igshid",
  "_hsenc",
  "_hsmi",
  "oly_enc_id",
  "cmpid",
]);

/**
 * Parameters that are only noise on one host. On x.com `?s=` is the share
 * surface tag; on an ordinary site it is usually a real query, and stripping
 * it there would collapse two different pages into one canonical URL.
 */
const HOST_TRACKING_PARAMS: Record<string, Set<string>> = {
  "x.com": new Set(["s"]),
};

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
    if (m) {
      u.pathname = `/abs/${m[1]}`;
      // Only a paper URL's query is noise. Clearing it for the whole host also
      // cleared it for listing and search pages, whose position lives in the
      // query, collapsing distinct pages onto one canonical URL.
      u.search = "";
    }
  }

  // Drop tracking params, keep the rest sorted for stability.
  // Read after the hostname rewrites above, so twitter.com is already x.com.
  const hostTracking = HOST_TRACKING_PARAMS[u.hostname];
  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    const key = k.toLowerCase();
    if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) continue;
    if (hostTracking?.has(key)) continue;
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
