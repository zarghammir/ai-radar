import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Narrow, JetBrains_Mono } from "next/font/google";
import { brand } from "@/config/brand";
import { ThemeScript } from "@/components/theme-script";
import { BottomNav, Sidebar } from "@/components/app-nav";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import "./globals.css";

/**
 * next/font downloads these at BUILD time and serves them from our own origin.
 * No request reaches Google from a reader's browser, which is what the README's
 * self-host promise and PRODUCT.md's no-external-reporting line require.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  display: "swap",
});

const archivoNarrow = Archivo_Narrow({
  variable: "--font-archivo-narrow",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
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
      className={`${archivo.variable} ${archivoNarrow.variable} ${jetbrainsMono.variable} h-full antialiased`}
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
        <div className="flex min-h-full flex-1">
          <Sidebar />
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
        </div>
        <BottomNav />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
