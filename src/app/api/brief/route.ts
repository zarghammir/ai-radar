import { getDb } from "@/db/client";
import { briefWindow, parseBriefLength, storiesInWindow, takeWithinReadingTime } from "@/api/brief";
import { getPreferences } from "@/api/reader";
import { handle, json } from "@/api/http";

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const now = new Date();
    const prefs = await getPreferences(getDb());
    const length = parseBriefLength(
      new URL(request.url).searchParams.get("length"),
      prefs.briefLength,
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
