/**
 * Remove every fragment of DATABASE_URL from a string.
 *
 * WHY THIS IS ITS OWN MODULE. It was written for `describeDbError` in
 * client.ts (#89) and is now needed by `describeError` in the pipeline (#99).
 * Two callers, one implementation: two redactors would drift, and the one that
 * drifted would be the one nobody was looking at. It lives here rather than
 * being exported from client.ts because `client.ts` owns a connection pool, and
 * a pipeline module should not have to import a connection pool to redact a
 * string. THIS FILE HAS NO IMPORTS AND OPENS NOTHING.
 *
 * WHAT IT DEFENDS AGAINST. GitHub Actions masks the VALUE of a registered
 * secret, not the PARTS of one. `DATABASE_URL` is registered as a whole string,
 * so its host, port, user, password and database name are each unmasked the
 * moment something prints them alone — and drivers print parts, not URLs.
 * Postgres goes further: `role "someuser" does not exist` is the SERVER's own
 * sentence, text we did not write and cannot enumerate.
 *
 * SO THIS REDACTS BY VALUE, NOT BY SHAPE. We parsed the URL, so we know each
 * part; anything matching one is replaced wherever it appears. That covers
 * message shapes no component has produced yet — which a pattern written
 * against today's messages cannot.
 */
export function redactConnectionParts(text: string): string {
  const url = process.env.DATABASE_URL;
  if (!url) return text;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // The URL is set but unparseable, so its parts are unknown and nothing can
    // be checked against them. Refusing to print is the only safe answer.
    //
    // This is a SUBSTITUTION, not a loss: the sentence below tells the operator
    // that DATABASE_URL will not parse, which is very nearly what the swallowed
    // message was about to say anyway.
    //
    // KNOWN DEGRADATION, one credential format. postgres.js also accepts the
    // libpq keyword DSN ("host=db.example.com user=me dbname=radar"), which
    // `new URL()` rejects. Someone connecting that way would connect fine and
    // then get this line for EVERY error, with the real reason swallowed.
    // Remote — .env.example and Neon both hand out URL-form strings — and left
    // as a caveat rather than a parser, because a second parser is a second
    // thing to get wrong. Named here so the next person meets it instead of
    // discovering it.
    return "[redacted: DATABASE_URL is set but could not be parsed, so the parts that would need removing are unknown]";
  }

  // Both forms of every part that can be percent-encoded: the RAW form as it
  // sits in the URL, and the DECODED form a driver is likely to print. Today
  // postgres.js prints decoded values, so the decoded form is the one that
  // fires — but the whole reason this redacts by value rather than by message
  // shape is to cover forms nothing has produced yet. Carrying both for the
  // user and only one for the password would be that principle applied to one
  // field and dropped for the next, in the file that exists to apply it.
  const rawDatabase = parsed.pathname.replace(/^\//, "");
  const candidates: Array<[string, string]> = [
    [url, "[connection string]"],
    [`${parsed.hostname}:${parsed.port}`, "[host]:[port]"],
    [safeDecode(parsed.password), "[password]"],
    [parsed.password, "[password]"],
    [parsed.hostname, "[host]"],
    [safeDecode(parsed.username), "[user]"],
    [parsed.username, "[user]"],
    [safeDecode(rawDatabase), "[database]"],
    [rawDatabase, "[database]"],
    [parsed.port, "[port]"],
  ];

  // Longest match first, so `host:port` and the full URL are consumed before
  // the shorter parts inside them. Enforced by sorting on value length rather
  // than by array order, so inserting a candidate in the wrong place cannot
  // corrupt a longer one. Fragments under three characters are left alone:
  // substituting a one- or two-character value would corrupt unrelated words,
  // and a credential that short is not what this is defending.
  let out = text;
  for (const [value, label] of candidates
    .filter(([value]) => value.length >= 3)
    .sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(value).join(label);
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
