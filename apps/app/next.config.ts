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
	/**
	 * Other hosts the dev server may serve its scripts and hot reload to, such
	 * as a Tailscale name for viewing it from another machine:
	 * `RECODER_DEV_ORIGINS=desktop.tailnet.ts.net bun run dev`.
	 */
	allowedDevOrigins: process.env.RECODER_DEV_ORIGINS?.split(',')
		.map((host) => host.trim())
		.filter(Boolean),
	agentRules: false,
	devIndicators: false,
	poweredByHeader: false
};

export default nextConfig;
