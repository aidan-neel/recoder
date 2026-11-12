import type { Metadata } from 'next';

import { PullsScreen } from '@/components/pulls/pulls-screen';

export const metadata: Metadata = { title: 'Pull requests' };

export default function PullsPage() {
	return <PullsScreen />;
}
