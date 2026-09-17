import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone: a minimal server plus only the node_modules Next
  // traces as reachable. This is what lets the Docker runtime image ship
  // without a build toolchain or dev dependencies. Verified against
  // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md
  output: "standalone",

  async headers() {
    return [
      {
        // Baseline hardening. The app is self-hosted by strangers, so the
        // defaults have to be safe without anyone configuring anything.
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // The service worker must never be cached, or a stale one keeps
        // serving a stale shell long after a deploy.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
