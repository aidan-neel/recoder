import type { Metadata } from 'next';

import { PageMissing } from '@/components/common/page-missing';

export const metadata: Metadata = { title: 'Not found' };

export default function NotFound() {
	return <PageMissing />;
}
