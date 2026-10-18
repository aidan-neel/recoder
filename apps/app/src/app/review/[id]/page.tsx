import type { Metadata } from 'next';

import { ReviewPage } from '@/components/review/review-page';

export const metadata: Metadata = { title: 'Review' };

export default async function Page({ params }: PageProps<'/review/[id]'>) {
	const { id } = await params;

	return <ReviewPage key={id} id={id} />;
}
