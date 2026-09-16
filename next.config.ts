import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone: a minimal server plus only the node_modules Next
  // traces as reachable. This is what lets the Docker runtime image ship
  // without a build toolchain or dev dependencies. Verified against
  // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md
  output: "standalone",
};

export default nextConfig;
