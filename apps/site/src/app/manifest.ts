import type { MetadataRoute } from 'next';

import { RECODER_MANIFEST } from '@/lib/appearance/manifest';

export default function manifest(): MetadataRoute.Manifest {
	return RECODER_MANIFEST;
}
