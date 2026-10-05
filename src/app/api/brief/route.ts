import { getDb } from "@/db/client";
import {
  DEFAULT_BRIEF_LENGTH,
  parseBriefLength,
  recentStories,
  reportingWindow,
  sweepSummary,
  takeBriefStories,
} from "@/api/brief";
import { getPreferences } from "@/api/reader";
import { handle, json } from "@/api/http";
import { parseViewOrThrow, typesForView } from "@/lib/api/views";
import { readerTopicKeys } from "@/lib/api/brief-length";

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const now = new Date();
    const prefs = await getPreferences(getDb());
    // The reader's preferred length lives in their BROWSER since #94, so this
    // route cannot read it and must not pretend to: a shared row would have
    // meant person 47's choice shortening person 12's brief. Callers that have
    // a preference send it as ?length=; this is the fallback for callers that
    // do not, and it is the app default rather than anyone's setting.
    const length = parseBriefLength(
      new URL(request.url).searchParams.get("length"),
      DEFAULT_BRIEF_LENGTH,
    );

    // The same filter the page applies, from the same function, so the two
    // cannot disagree about what a brief is.
    //
    // OMITTED means everything stored, which is what this route returned before
    // #102. UNRECOGNISED is refused rather than widened — a typo must not open
    // the front door, and falling back to "all" is exactly how it would. That
    // matches parseBriefLength on the line below, which throws rather than
    // guessing, and the same rule #105 sets for its own axis.
    const view = parseViewOrThrow(new URL(request.url).searchParams.get("view"), "all");
    // THE READER'S OWN TOPICS, from their cookie — or from `?topics=` when a
    // client says so explicitly, which is also what lets a test drive this
    // route with no cookie jar. Same reason as ?length=: the preference lives
    // on the device, so the device has to send it. Unparseable keys are
    // dropped, not refused; a cookie is untrusted input and a stray character
    // must not take the feed away.
    const topics = await readerTopicKeys(new URL(request.url).searchParams.get("topics"));
    const reported = reportingWindow(now, prefs.briefTime, prefs.timezone);
    const ranked = await recentStories(getDb(), {
      types: typesForView(view),
      readerTopicKeys: topics,
      now,
    });
    const stories = takeBriefStories(ranked, length);
    // The route carries it too, so a client of the API gets the same account of
    // an empty brief that the page does. Two answers to "why is this empty"
    // would be one more than there should be.
    const sweep = await sweepSummary(getDb(), reported.from);

    return json({
      window: {
        from: reported.from.toISOString(),
        to: reported.to.toISOString(),
        briefTime: reported.briefTime,
        timezone: reported.timezone,
      },
      length,
      view,
      // Which topics this order was ranked for, so a client can tell a
      // personalised response from the stored order without inferring it.
      topics,
      // Both describe the response, not the window.
      count: stories.length,
      readingMinutes: stories.reduce((n, s) => n + s.readingMinutes, 0),
      stories,
      sweep,
    });
  });
}
