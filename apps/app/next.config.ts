import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/** The repo root, so Turbopack can read the workspace packages, the kit's px-to-rem step among them. */
const root = fileURLToPath(new URL('../../', import.meta.url));

const nextConfig: NextConfig = {
	turbopack: { root },
	transpilePackages: ['@recoder/ui', '@recoder/shared'],
	/** Each route bundles only the kit parts it imports, so the queue never ships the code highlighter or Markdown. */
	experimental: { optimizePackageImports: ['@recoder/ui'] },
	/** The Docker image sets `NEXT_OUTPUT=standalone` to ship only the traced server files (`apps/app/Dockerfile`). */
	output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
	agentRules: false,
	devIndicators: false,
	poweredByHeader: false
};

export default nextConfig;
