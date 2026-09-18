import { getDb } from "@/db/client";
import {
  DEFAULT_BRIEF_LENGTH,
  briefWindow,
  parseBriefLength,
  storiesInWindow,
  takeWithinReadingTime,
} from "@/api/brief";
import { getPreferences } from "@/api/reader";
import { handle, json } from "@/api/http";

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

    const window = briefWindow(now, prefs.briefTime, prefs.timezone);
    const ranked = await storiesInWindow(getDb(), window);
    const stories = takeWithinReadingTime(ranked, length);

    return json({
      window: {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        briefTime: window.briefTime,
        timezone: window.timezone,
      },
      length,
      // Both describe the response, not the window.
      count: stories.length,
      readingMinutes: stories.reduce((n, s) => n + s.readingMinutes, 0),
      stories,
    });
  });
}
