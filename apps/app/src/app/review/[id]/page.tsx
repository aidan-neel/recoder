import type { Metadata } from 'next';

import { ReviewRoute } from '@/components/shell/review-route';

export const metadata: Metadata = { title: 'Review' };

export default async function Page({ params }: PageProps<'/review/[id]'>) {
	const { id } = await params;

	return <ReviewRoute id={id} />;
}
