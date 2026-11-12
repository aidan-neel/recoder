import type { Metadata } from 'next';

import { ReviewRedirect } from '@/components/pull/review-redirect';

export const metadata: Metadata = { title: 'Review' };

interface ReviewPageProps {
	params: Promise<{ id: string }>;
}

export default async function ReviewPage({ params }: ReviewPageProps) {
	return <ReviewRedirect id={(await params).id} />;
}
