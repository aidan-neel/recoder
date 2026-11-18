import type { MetadataRoute } from 'next';

import { docHref, docs } from '~/lib/docs';
import { SITE_URL } from '~/lib/site';

/** The home page and every docs page. */
export default function sitemap(): MetadataRoute.Sitemap {
	return [{ url: SITE_URL }, ...docs.map((doc) => ({ url: `${SITE_URL}${docHref(doc)}` }))];
}
