import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/** The repo root, so Turbopack can read the workspace packages, the kit's px-to-rem step among them. */
const root = fileURLToPath(new URL('../../', import.meta.url));

const nextConfig: NextConfig = {
	/**
	 * Strict mode renders and runs effects twice in development only, which
	 * made dev hydration a fifth slower. It is opt-in: `RECODER_STRICT=1 bun run dev`.
	 */
	reactStrictMode: process.env.RECODER_STRICT === '1',
	turbopack: { root },
	transpilePackages: ['@recoder/ui', '@recoder/shared'],
	experimental: {
		/**
		 * Every page's server payload is only its components and the address:
		 * the data loads in the browser. So a page visited in the last five
		 * minutes opens from the router's cache, with no request and no
		 * loading skeleton between two open reviews.
		 */
		staleTimes: { dynamic: 300 },
		/**
		 * The stylesheet ships inside the document, so the first frame is
		 * styled (no blank white or gray frame while a separate CSS file
		 * loads) and paints about a third sooner on a slow CPU. A full load
		 * carries about 70 KB more HTML; client navigations do not.
		 */
		inlineCss: true
	},
	/** The Docker image sets `NEXT_OUTPUT=standalone` to ship only the traced server files (`apps/app/Dockerfile`). */
	output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
	agentRules: false,
	devIndicators: false,
	/** The dev warm-up's requests (`scripts/warm-routes.ts`, marked `?warm`) stay out of the terminal's request log. */
	logging: { incomingRequests: { ignore: [/\?warm$/] } },
	poweredByHeader: false
};

export default nextConfig;
