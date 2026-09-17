# AI Radar — Design System

The visual world is **The Select Rail**: a film cutting bench flattened onto a screen.
Stories string along a perforated rail as paper prints; you mark what you have read, a
folded orange flag holds your place, and what you keep hangs on pins in a bin.

This document records what was built, not what was intended. Every value below is taken
from the shipped prototype in `design/prototype/`.

Approved by the owner on 2026-09-16 after two direction rounds (issue #11).

---

## 1. The palette law

> **`--org` is reserved.** It marks only what is **live** or **where you are**: the reading
> mode in force, the flag where you stopped, the tab or nav item you are on, and the current
> hour on the arrivals chart.

It is never a link colour, never a content-type badge, never a severity colour, never
decoration. If a new surface needs "an accent", it does not get orange — it gets weight,
rule, or ink. This is the single rule most likely to be broken by a future change, and the
one that keeps the interface calm.

Colour never carries meaning alone. Verification is a **four-bar meter plus the word**.
The current tab is an **orange bar plus a heavier label**. Content type is **a word**.

## 2. Colour tokens

Defined in `design/prototype/styles/tokens.css`. Dark is the world's native ground; light is
the same bench in daylight. Both are authored, neither is a naive inversion.

| Token        | Light     | Dark      | Role                                                      |
| ------------ | --------- | --------- | --------------------------------------------------------- |
| `--bg`       | `#E4E3DE` | `#0B0C0E` | the bench                                                 |
| `--bg-2`     | `#DAD8D2` | `#141518` | nav bars, sidebar, chrome wells                           |
| `--paper`    | `#FFFFFF` | `#F3F3F1` | the print you read on — light in **both** themes          |
| `--edge`     | `#CBC9C2` | `#2A2B2E` | chrome hairlines, sprocket holes                          |
| `--ink`      | `#17181B` | `#17181B` | headlines and body, on paper                              |
| `--soft`     | `#585C62` | `#585C62` | summaries and labels, on paper                            |
| `--faint`    | `#E2E0D9` | `#E2E0D9` | rules drawn on paper                                      |
| `--faint-2`  | `#C9C7C0` | `#C9C7C0` | empty meter segments, chip borders                        |
| `--ash`      | `#5A564E` | `#9A958A` | chrome text on the bench                                  |
| `--ash-hi`   | `#3D3A34` | `#D6D1C6` | chrome text that must carry weight                        |
| `--org`      | `#F0531C` | `#F0531C` | **reserved.** Fill only                                   |
| `--org-on`   | `#0B0C0E` | `#0B0C0E` | the only text colour allowed on an orange fill            |
| `--meta`     | `#6E6A61` | `#6E6A61` | mono meta text on paper (5.0:1, constant)                 |
| `--org-text` | `#B3380B` | `#F0531C` | orange as text, **on the bench only** — see the law below |

**Paper stays light in dark mode on purpose.** Reading happens on the print; the dark ground
is the bench it sits on. This is why the app is comfortable at 7am without being a dark-mode
compromise: body text is always dark ink on light paper, at roughly 15:1.

`--org-text` exists only because `#F0531C` as _text_ on the light bench measures 2.74:1. It
is used nowhere for state — the orange **bar** marks the current item instead — and as of the
review of PR #23 it is used nowhere in the prototype's CSS at all.

> **Second palette law: orange as text never goes on paper.** `--org-text` is safe on the
> bench in both themes (4.69:1 light, 5.55:1 dark) and on `--paper` in light only (6.02:1).
> On `--paper` in **dark** it is `#F0531C` and measures **3.17:1**, which fails AA for normal
> text. The external-link arrow shipped that way and the reviewer caught it; it is now
> `--soft`. Anything drawn on paper takes `--ink`, `--soft` or `--meta`. If orange on paper is
> ever genuinely needed, add a `--org-text-on-paper` token that clears 4.5:1 in _both_ themes
> rather than reusing this one.

This matters for issue #12: the app shell is built from this document, and the prototype's one
accessibility failure was exactly this pairing.

### Charts

Charts use **one ink** (`currentColor`, inherited from the paper surface) plus the reserved
orange for "now". There is no categorical chart palette, so no series-colour ordering is
needed. The pair was checked with the dataviz validator: colour-blind separation ΔE 36.0
(protan) and 49.9 (tritan), contrast above 3:1 on paper. The validator's lightness-band and
chroma-floor checks fail by design — they apply to categorical hue slots, and `--ink` is a
deliberately achromatic near-black.

## 3. Type

Three faces, each with a job. Loaded from Google Fonts with real fallback stacks.

| Role    | Face                           | Used for                                                  |
| ------- | ------------------------------ | --------------------------------------------------------- |
| Text    | **Archivo** 400/500/600/700    | headlines, summaries, body, controls                      |
| Label   | **Archivo Narrow** 600/700     | small capitals: content type, section labels, nav, grades |
| Machine | **JetBrains Mono** 400/500/700 | times, counts, entry numbers, hostnames, axis ticks       |

Condensed type is for labels only. It never sets anything you have to read a sentence of —
that was the single biggest legibility complaint in direction round one.

### Type scale

| Token         | Size   | Line height | Where                                   |
| ------------- | ------ | ----------- | --------------------------------------- |
| `--t-display` | 27px   | 1.10        | the greeting; 34px on desktop           |
| `--t-lead`    | 25px   | 1.16        | lead story headline; 30px on desktop    |
| `--t-title`   | 20px   | 1.22        | story headline; 22px on desktop         |
| `--t-body`    | 15px   | 1.50        | summaries; 16px on desktop              |
| `--t-why`     | 14.5px | 1.48        | why-it-matters, key points, timeline    |
| `--t-small`   | 13px   | 1.45        | dates, hints, source links              |
| `--t-label`   | 10.5px | —           | small capitals, `letter-spacing: .18em` |
| `--t-meta`    | 10.5px | —           | mono meta, `tabular-nums`               |

Headlines carry `text-wrap: balance` and negative tracking from `-.014em` to `-.024em` as
size rises. Every column of digits uses `font-variant-numeric: tabular-nums`.

## 4. Spacing

A 4px base. `--s1: 4` `--s2: 6` `--s3: 8` `--s4: 12` `--s5: 16` `--s6: 20` `--s7: 24`
`--s8: 32` `--s9: 40`. Sibling groups are laid out with flex or grid and `gap`, never with
per-element margins that collapse.

Structure: `--rail-w: 26px` (the sprocket strip), `--radius: 2px` (film has corners, not
pills), `--sidebar-w: 248px`, `--column-w: 720px`, `--aside-w: 300px`.

## 5. The badge system

**Two labels on every story, always. They are different things and they never merge.**

**Content type** — what kind of thing this is. Archivo Narrow, 11px, `.18em` tracking,
uppercase, `--soft`, **no box**, sits top-left. Values: News, Release, Paper, Model,
Discussion, Signal.

**Verification** — how well-sourced it is. A **bordered chip** containing a four-segment
meter and the word, sits top-right. Values:

| Grade          | Bars | Means                                                  |
| -------------- | ---- | ------------------------------------------------------ |
| Primary source | 4    | The company, lab or author published it themselves.    |
| Corroborated   | 3    | Two or more independent outlets report the same thing. |
| Emerging       | 2    | One outlet so far. Probably true, not yet confirmed.   |
| Unverified     | 1    | A rumour, a leak or an anonymous claim.                |

They differ by **shape** (no box vs bordered chip), **position** (left vs right), **weight**
and **content** (a category word vs a meter and a grade word). A reader can tell them apart
with the colour removed, which is the test that matters.

**Unverified items are allowed in Today's Brief**, labelled. Owner's ruling, 2026-09-16: a
leak can be the most important thing that happened, and the chip is what makes it safe to
show. The story page always explains the grade in a "How this was graded" note.

The grade key is available on every surface — compact in the desktop sidebar, in full with
definitions in Settings — never a one-time onboarding screen.

## 6. Layout

**Phone (390).** Single column. A 26px sprocket rail down the left edge, carrying the entry
number on Today and running continuously on Radar and Saved. Four-tab bar pinned to the
bottom, current tab marked by an orange bar above a heavier label.

**Laptop (1440).** A 248px sidebar (wordmark, nav with live counts, compact grade key pinned
to the bottom), a reading column up to 720px, and a 300px right rail used on Today for
"How today grades out" and "Today's shape", and on Radar for your topics. The tab bar is
hidden; the sidebar replaces it.

The rail is present at both sizes. It is the identity; it does not get dropped on desktop.

## 7. Charts

All three are measurements, never decoration.

- **Pickup** (story card and story page) — cumulative outlets reporting, over the hours after
  the first report. A step line with a filled area at 9% and an emphasised endpoint. A flat
  line means nobody followed the story.
- **Why it ranked** (story page) — horizontal bars for each ranking signal, with the value
  named at the end. A penalty is drawn as a 45° hatch so it reads as subtraction, not
  strength.
- **Arrivals by hour** (Radar, and Today's right rail) — 24 columns, one per hour, the current
  hour in the reserved orange. Zero-count hours keep a 1.5px stub at 16% so the axis reads as
  continuous rather than broken.

Every chart carries a `role="img"` and an `aria-label` stating what it shows and its peak, and
per-mark `<title>` elements for hover.

## 8. Accessibility

The bar is **WCAG 2.2 AA**, recorded from the owner's own words: "I just want an application
that everyone can use."

Measured on the shipped prototype across 24 states (5 screens plus first-run × 2 breakpoints ×
2 themes) by `design/contrast-audit.js`, which is in the repository so the numbers can be
reproduced and disputed:

|                                                | measured |
| ---------------------------------------------- | -------- |
| states rendered                                | 24 / 24  |
| meaningful text elements                       | 1766     |
| decorative `·` separators, reported separately | 112      |
| total text nodes (1766 + 112)                  | 1878     |
| contrast failures                              | **0**    |
| horizontal overflow                            | 0 px     |
| real external anchors                          | 88       |

Thresholds are 4.5:1 for normal text and 3:1 at ≥24px or ≥18.66px bold, computed from rendered
colours with translucent foregrounds composited and the ancestor chain composited to an opaque
background. Per-screen element counts: Today 131 phone / 157 laptop, Radar 119 / 134, Story 56
/ 65, Saved 34 / 43, Settings 69 / 78, First run 22 / 31.

**An earlier version of this section claimed "1768 text elements, 0 contrast failures" and that
was wrong.** The audit script skipped any element whose text was shorter than two characters,
which excluded the single-glyph `↗` external-link arrow — the one element that was failing, at
3.17:1 in dark. A filter that removes the failing case makes a measurement agree with itself.
The script now counts text of any length, and reverting the arrow fix makes it report exactly
the 8 failures the reviewer found, which is what proves it can fail at all.

The 112 `·` separators in the Radar list are `--edge` at 10px (1.29:1 light, 1.38:1 dark). WCAG
exempts pure decoration so they are not counted as failures, but they are counted and shown
rather than dropped. They are announced by a screen reader as "middle dot" 28 times per list;
drawing them as pseudo-elements or marking them `aria-hidden` is queued for #12.

- Verification, content type and current-tab state each carry a non-colour signal.
- Every control is a real `<button>` or `<a>`; focus is a 2px orange outline with 2px offset.
- The source link on a card is a real `<a href target="_blank" rel="noopener">`. The card's
  own click handler yields to it, so a link never opens the story sheet instead.
- The headline is the keyboard-reachable control that opens a story.
- `prefers-reduced-motion: reduce` collapses all animation and transition durations.
- Charts are labelled; the grade key gives every meter a word.

## 9. Content rules

- **Real content only.** All 14 stories in the prototype are genuine, from 9–16 September
  2026, with real outlets and working URLs. No lorem, no invented outlets, no fabricated
  benchmarks, prices or user counts.
- **State one number once.** The Radar header count, its chart legend and the sidebar badge
  all read from one computed total.
- **Reading time is skim time.** The brief's stated minutes are for the cards shown, not the
  sum of the full articles. A story's own `minutes` is how long the original takes and belongs
  on the story page.
- **Bounded, never endless.** 5 minutes gives four stories, 10 gives eight, Everything gives
  the lot. The count and the minutes are stated before you start. There is no infinite scroll.

## 10. Where these tokens live now

As of issue #12 the system is implemented, not just described.

- `src/app/globals.css` carries every token above as CSS custom properties, and
  **shadcn's semantic tokens are mapped onto them** (`--card` is `--paper`, `--muted-foreground`
  is `--ash`, `--ring` is `--org`, and so on). A shadcn component added later inherits this
  world instead of introducing a second palette.
- `src/config/brand.ts` holds the approved palette: `themeColor` is the bench per theme,
  `accent` is the reserved orange, and `accentText` carries the light/dark split that palette
  law two requires. `app/manifest.ts` and the root metadata read from it, so renaming the
  product renames the installed app.
- The three faces are self-hosted by `next/font` at build time. The production build contains
  **no reference to `fonts.googleapis.com` or `fonts.gstatic.com`** and emits 12 `woff2` files
  from our own origin. A reader's browser never contacts Google.
- Layout switches on **real CSS media queries** (Tailwind's `lg:`, min-width 64rem): the
  sidebar is `hidden lg:flex`, the bottom bar `lg:hidden`. Nothing switches on a class toggled
  from JavaScript.
- Separators in the shell are drawn as pseudo-elements or `aria-hidden` spans, never as text
  nodes.

### Still not decided

- **Motion.** Deliberately none beyond the reduced-motion guard. The flag, the reading-mode
  switch and the tab marker are where it would earn its keep.
- **Data.** The shell ships with honest empty states; nothing fetches yet.
- **The settings that need a pipeline** — sources, brief time, notification choice — are
  described on the page as not yet wired, rather than shown as dead controls.
