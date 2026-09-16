# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase: Next.js (App Router) + TypeScript + Tailwind, PostgreSQL, a separate
ingestion worker. Installed as a self-hosted app via Docker Compose. Delivered as a PWA
(manifest, theme color, optional web push).

For issue #11 only, the deliverable is a static, framework-free HTML/CSS prototype under
`design/prototype/`. No `src/app` code changes in this ticket.

## Users

Primary user: the owner (Zargham Mir) — a founder/operator who builds AI products and
needs to know what actually happened in AI before the workday starts. Reads on a phone,
early, often one-handed; returns on a laptop for depth.

Secondary: anyone who self-hosts the published open-source app. Confirmed by the owner:
"it would be for me, but if anyone wants to install it they can, but not changing it."
They are installers and readers, not co-designers. The app therefore ships with sensible
defaults and guardrails rather than a configuration surface that assumes expertise.

## Product Purpose

Open the app once in the morning and, in five to ten minutes, know the AI news, releases,
research, discussions and early signals that matter — and know where each claim originally
came from. Success is the user closing the app confident they are current, having read a
bounded amount rather than scrolling an endless feed.

## Positioning

Provenance is a first-class, separate dimension. Every item carries two independent
labels: **verification level** (primary source / corroborated / emerging / unverified)
and **content type** (news / release / paper / model / discussion / signal). Most feed
readers collapse these into one notion of "source". Keeping them apart is what lets the
app show a rumour safely and lets the reader calibrate trust at a glance.

Ranking is deterministic and explainable: the app can always answer "why is this here".
AI summarization is optional — with no LLM provider configured, the product still works
and shows source excerpts instead.

## Operating Context

- **Morning ritual, phone, 5–10 minutes.** The brief has bounded reading modes: 5-minute,
  10-minute, everything.
- **Laptop follow-up.** Story detail, timeline, and the full radar are read at a desk.
- **Self-hosted.** No paid API required. Ingestion runs on a schedule (default 30 min).
- Surfaces: Today's Brief, Live Radar, Research, Releases, Saved, Settings (with
  first-run onboarding).

## Capabilities and Constraints

- Verification and content type are two separate elements on every card. Confirmed.
- **Unverified items are allowed in Today's Brief, always labelled.** Owner's ruling:
  a leak can be the most important thing that happened; the chip is what makes it safe
  to show.
- No gradients, no marketing hero, no infinite scroll. Reading is bounded by design.
- Security and guardrails matter because the app is public and self-installed by
  strangers; the UI must not invite unsafe configuration.
- Optional/undecided: web push, email digest, X/Twitter ingestion (milestone 3).
- Deterministic ranking must remain inspectable in the UI ("why ranked" panel).

## Brand Commitments

- Name **AI Radar**; all naming resolves from `src/config/brand.ts`, never hard-coded.
- Tagline: "The AI developments you actually need to know today."
- MIT licensed, © Zargham Mir. Repository github.com/zarghammir/ai-radar.
- `brand.ts` currently declares theme colors `#fafaf9` / `#0c0c0d` and accent `#2563eb`.
  These are scaffold values, not an approved identity; the direction round decides the
  real palette and `brand.ts` follows it.

## Evidence on Hand

- Real story content is required. Story cards in the prototype use genuine AI stories
  from the week of 2026-09-09 to 2026-09-16, with real headlines, real publishers and
  real URLs. Lorem ipsum and invented outlets are forbidden.
- No users, customers, testimonials, benchmarks, pricing or install counts exist. None
  may be invented anywhere in the product.
- The app has no paid tier and makes no commercial claims.

## Product Principles

1. **Bounded, not endless.** The product's promise is being done, not being fed.
2. **Say where it came from.** Provenance travels with every claim, separately from
   what kind of thing it is.
3. **Explainable over clever.** Ranking, verification and summaries must be inspectable.
4. **Works with nothing configured.** Defaults are safe, useful and guarded.
5. **Read first, act second.** This is a reading instrument; controls stay out of the way.

## Accessibility & Inclusion

Owner's answer: "I just want an application that everyone can use — relate to the UI
standards." Recorded as **WCAG 2.2 AA** as the floor:

- Body and UI text at 4.5:1 minimum against its own background, in both themes;
  large text and non-text indicators at 3:1.
- Verification and content type are never encoded by color alone — each carries a label.
- Every interactive element reachable by keyboard with a visible focus indicator.
- `prefers-reduced-motion` respected.
- Designed to stay legible outdoors at morning-commute brightness; no hairline grey
  text that survives only on a studio display.
