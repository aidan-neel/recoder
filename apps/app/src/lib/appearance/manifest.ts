import type { MetadataRoute } from 'next';

import { CHROME_DARK } from '@/lib/appearance/viewport';

/** The install manifest the app and the site share: the name, the icons in each app's `public/`, and the dark chrome. */
export const RECODER_MANIFEST: MetadataRoute.Manifest = {
	name: 'Recoder',
	short_name: 'Recoder',
	start_url: '/',
	display: 'standalone',
	theme_color: CHROME_DARK,
	background_color: CHROME_DARK,
	icons: [
		{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
		{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
	]
};
