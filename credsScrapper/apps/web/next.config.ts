import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` otherwise writes its own AGENTS.md/CLAUDE.md into this
  // directory on every start (same fix datatector's apps/web uses).
  agentRules: false,
};

export default nextConfig;
