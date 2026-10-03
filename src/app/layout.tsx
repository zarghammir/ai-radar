import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { brand } from "@/config/brand";
import { ThemeScript } from "@/components/theme-script";
import { AppChrome, BottomNav } from "@/components/app-chrome";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { FirstRunGate } from "@/components/onboarding/first-run-gate";
import "./globals.css";

/**
 * THE THREE BRAND FACES, SERVED FROM FILES IN THIS REPOSITORY.
 *
 * WHY THEY ARE VENDORED (#160). These used next/font/google, which fetches from
 * fonts.gstatic.com AT BUILD TIME. That put a third party inside every build:
 * four of one week's five red CI runs were that fetch failing, each one green on
 * a re-run with no code changed. A retry makes green cheaper to obtain; it does
 * not make the dependency stop existing. The files are committed instead.
 *
 * The reader-facing promise is unchanged and was already true: no request reached
 * Google from a reader's browser before, because next/font self-hosted what it
 * downloaded. What changes is that THE BUILD no longer reaches Google either.
 *
 * WHY TWELVE CALLS AND NOT THREE. Google ships each family split by unicode-range
 * — one file per subset — so a reader downloads only the ranges their text needs.
 * next/font/local takes ONE set of `declarations` per call, so unicode-range
 * cannot vary between entries of a single call. One call per subset is the only
 * way to keep that split, and keeping it is why this change costs a reader ZERO
 * extra bytes: same files, same ranges, same lazy fetching. The alternative —
 * one unsubsetted file per family — was measured and rejected: the only
 * unsubsetted artefacts published anywhere are variable TTFs totalling 939,108
 * bytes against 94,144 bytes of woff2 that a latin-only reader fetches today.
 *
 * THE TRAP IN THIS SHAPE, and the reason for adjustFontFallback: false below.
 * Each call emits its own metric-adjusted "<Name> Fallback" family, which is a
 * local Arial carrying NO unicode-range and can therefore serve any character.
 * Chained naively, --font-sans would read: archivo-latin, archivo-latin Fallback,
 * archivo-latin-ext, … — so a Polish or Vietnamese character, which the latin
 * face declines by unicode-range, would be served by adjusted Arial WHILE THE
 * REAL latin-ext FILE SAT UNUSED. Every glyph in English would be correct, which
 * is exactly why it would survive review. So the fallback is switched off on
 * every call but the LAST of each family, leaving one fallback after the real
 * faces. All subsets of one typeface share its metrics, so which file computes
 * them does not matter — verified: the emitted percentages are unchanged.
 *
 * Provenance, licences and sha256 for every file: src/app/fonts/PROVENANCE.md.
 * `node scripts/verify-vendored-fonts.mjs` checks the bytes still match it.
 */

// Archivo — body and headings. font-stretch is declared because the upstream face
// carries a wdth axis and next/font/google emitted font-stretch:100% for it.
const archivoLatin = localFont({
  src: "./fonts/archivo-latin.woff2",
  variable: "--font-archivo-latin",
  weight: "100 900",
  style: "normal",
  display: "swap",
  declarations: [
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const archivoLatinExt = localFont({
  src: "./fonts/archivo-latin-ext.woff2",
  variable: "--font-archivo-latin-ext",
  weight: "100 900",
  style: "normal",
  display: "swap",
  declarations: [
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  adjustFontFallback: false,
});

const archivoVietnamese = localFont({
  src: "./fonts/archivo-vietnamese.woff2",
  variable: "--font-archivo-vietnamese",
  weight: "100 900",
  style: "normal",
  display: "swap",
  declarations: [
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
  adjustFontFallback: false,
});

// Archivo Narrow — labels. NOT variable in this app: layout asked for weights 600
// and 700, and Google answers that with two @font-face blocks per subset pointing
// at ONE file. The two-entry src array reproduces exactly that.
//
// narrowLatin KEEPS ITS FALLBACK EVEN THOUGH IT IS NOT LAST IN --font-label, which
// is the one place the "exactly one fallback, positioned last" rule is bent. The
// label chain runs narrow, then archivo, so narrowLatin's unrestricted fallback
// sits ahead of three real faces. Reviewed and kept, on measurement: at
// 10.5px/700/0.18em, "SOURCE PROVENANCE" is 132.13px in the real narrow face,
// 132.11px in narrowLatin Fallback, and 156.84px in archivoLatin Fallback. Turning
// narrow's fallback off would make seventeen label call sites 18.7% too wide before
// the swap — a real regression bought to remove a hazard that cannot currently
// fire, because the archivo tier covers exactly the ranges the narrow tier does.
//
// That "cannot currently fire" is a fact about the FILES, so it is checked rather
// than trusted: verify-vendored-fonts.mjs fails if Archivo ever gains a subset
// Narrow lacks, which is the change that would strand a face behind this fallback.
const narrowLatin = localFont({
  src: [
    { path: "./fonts/archivo-narrow-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/archivo-narrow-latin.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-archivo-narrow-latin",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const narrowLatinExt = localFont({
  src: [
    { path: "./fonts/archivo-narrow-latin-ext.woff2", weight: "600", style: "normal" },
    { path: "./fonts/archivo-narrow-latin-ext.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-archivo-narrow-latin-ext",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  adjustFontFallback: false,
});

const narrowVietnamese = localFont({
  src: [
    { path: "./fonts/archivo-narrow-vietnamese.woff2", weight: "600", style: "normal" },
    { path: "./fonts/archivo-narrow-vietnamese.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-archivo-narrow-vietnamese",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
  adjustFontFallback: false,
});

// JetBrains Mono — timestamps, counts and tabular numerals.
const monoLatin = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  variable: "--font-jetbrains-mono-latin",
  weight: "100 800",
  style: "normal",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const monoLatinExt = localFont({
  src: "./fonts/jetbrains-mono-latin-ext.woff2",
  variable: "--font-jetbrains-mono-latin-ext",
  weight: "100 800",
  style: "normal",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  adjustFontFallback: false,
});

const monoVietnamese = localFont({
  src: "./fonts/jetbrains-mono-vietnamese.woff2",
  variable: "--font-jetbrains-mono-vietnamese",
  weight: "100 800",
  style: "normal",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
  adjustFontFallback: false,
});

const monoGreek = localFont({
  src: "./fonts/jetbrains-mono-greek.woff2",
  variable: "--font-jetbrains-mono-greek",
  weight: "100 800",
  style: "normal",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF",
    },
  ],
  adjustFontFallback: false,
});

const monoCyrillic = localFont({
  src: "./fonts/jetbrains-mono-cyrillic.woff2",
  variable: "--font-jetbrains-mono-cyrillic",
  weight: "100 800",
  style: "normal",
  display: "swap",
  declarations: [
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
  adjustFontFallback: false,
});

const monoCyrillicExt = localFont({
  src: "./fonts/jetbrains-mono-cyrillic-ext.woff2",
  variable: "--font-jetbrains-mono-cyrillic-ext",
  weight: "100 800",
  style: "normal",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
    },
  ],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.description,
  applicationName: brand.name,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: brand.shortName,
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: brand.themeColor.light },
    { media: "(prefers-color-scheme: dark)", color: brand.themeColor.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivoLatin.variable} ${archivoLatinExt.variable} ${archivoVietnamese.variable} ${narrowLatin.variable} ${narrowLatinExt.variable} ${narrowVietnamese.variable} ${monoLatin.variable} ${monoLatinExt.variable} ${monoVietnamese.variable} ${monoGreek.variable} ${monoCyrillic.variable} ${monoCyrillicExt.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <a
          href="#main"
          className="bg-org text-org-on focus:ring-org sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-xs focus:px-4 focus:py-2 focus:ring-2 focus:outline-none"
        >
          Skip to content
        </a>
        <AppChrome />
        {/* The bottom bar is fixed and adds env(safe-area-inset-bottom) to its
            own height, so flat padding leaves content under it on a
            home-indicator phone. Headless Chromium reports the inset as 0,
            so no test here can see the difference. UNVERIFIED ON HARDWARE. */}
        <main
          id="main"
          className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0"
        >
          {children}
        </main>
        <BottomNav />
        <ServiceWorkerRegistrar />
        {/* Renders nothing. Sends a reader who has never been here to the
            welcome screen — from any page, and never on a failed read. */}
        <FirstRunGate />
      </body>
    </html>
  );
}
