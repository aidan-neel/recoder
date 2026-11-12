import type { Metadata } from 'next';

import { LivePulls } from '@/components/pulls/live-pulls';

export const metadata: Metadata = { title: 'Pull requests' };

export default function PullsPage() {
	return <LivePulls />;
}
