import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/** The repo root, so Turbopack can read the workspace packages and the apps/app modules the hero demo renders. */
const root = fileURLToPath(new URL('../../', import.meta.url));

const nextConfig: NextConfig = {
	turbopack: { root },
	transpilePackages: ['@recoder/ui'],
	/** Each route bundles only the kit parts it imports, so the home page never ships the Markdown renderer. */
	experimental: { optimizePackageImports: ['@recoder/ui'] },
	agentRules: false,
	devIndicators: false,
	poweredByHeader: false
};

export default nextConfig;
