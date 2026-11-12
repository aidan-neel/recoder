import type { Metadata } from 'next';

import { PullRoute, type PullRouteParams } from '@/components/pull/pull-route';

interface PullPageProps {
	params: Promise<PullRouteParams>;
}

export async function generateMetadata({ params }: PullPageProps): Promise<Metadata> {
	return { title: `#${(await params).number}` };
}

export default async function PullPage({ params }: PullPageProps) {
	return <PullRoute {...await params} />;
}
