/**
 * Saves the first few stories on Today by CLICKING SAVE, then folds notes and
 * tags into what that click stored.
 *
 * WHY NOT PLANT THE STORAGE DIRECTLY, which is what the scripts used to do.
 * Since #91 a saved story is an id AND a snapshot of the card, because the ids
 * are this browser's and the catalogue is shared and nothing else turns one
 * into the other. A script that writes ids with no snapshot produces a bin that
 * renders EMPTY — against fixtures the ids happen to exist in the built-in
 * catalogue so it looks fine, and against a live database they resolve to
 * nothing.
 *
 * That is exactly how CI failed while the same sweep passed locally: same code,
 * different data. So the state is created the way a reader creates it, and the
 * script cannot drift from the app's storage shape because it never writes it.
 *
 * The notes and tags are MERGED into the existing entry rather than replacing
 * it — replacing is what dropped the snapshot in the first place.
 */
export async function saveThroughUi(context, base, marks) {
  const page = await context.newPage();
  await page.goto(`${base}/?length=all`, { waitUntil: "networkidle" });

  const landed = new URL(page.url()).pathname;
  if (landed !== "/") {
    await page.close();
    return { saved: [], landed };
  }

  const wanted = marks.length;
  const saved = [];
  for (let index = 0; index < wanted; index += 1) {
    const card = page.locator("article[data-story-id]").nth(index);
    if ((await card.count()) === 0) break;
    const id = Number(await card.getAttribute("data-story-id"));
    const button = card.getByRole("button", { name: /^Save$/ });
    if ((await button.count()) === 0) continue;
    await button.click();
    await page.waitForTimeout(120);
    saved.push(id);
  }

  // Fold the note and tags into the entry the click created, keeping its card.
  await page.evaluate(
    ([ids, marks]) => {
      try {
        const key = "ai-radar-fixture-marks";
        const all = JSON.parse(localStorage.getItem(key) ?? "{}");
        ids.forEach((id, index) => {
          const existing = all[String(id)] ?? {};
          all[String(id)] = { ...existing, ...marks[index] };
        });
        localStorage.setItem(key, JSON.stringify(all));
      } catch {}
    },
    [saved, marks],
  );

  await page.close();
  return { saved, landed };
}
