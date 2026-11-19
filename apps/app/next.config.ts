import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/** The repo root, so Turbopack can read the workspace packages, the kit's px-to-rem step among them. */
const root = fileURLToPath(new URL('../../', import.meta.url));

const mode = process.env.NEXT_OUTPUT;
const output = mode === 'export' || mode === 'standalone' ? mode : undefined;

const nextConfig: NextConfig = {
	turbopack: { root },
	transpilePackages: ['@recoder/ui', '@recoder/shared'],
	/** Each route bundles only the kit parts it imports, so the queue never ships the code highlighter or Markdown. */
	experimental: { optimizePackageImports: ['@recoder/ui'] },
	output,
	distDir: output === 'export' ? 'dist' : undefined,
	env: output === 'export' ? { NEXT_PUBLIC_API_URL: '' } : undefined,
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
