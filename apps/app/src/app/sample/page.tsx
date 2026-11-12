import type { Metadata } from 'next';

import { PullsScreen } from '@/components/pulls/pulls-screen';

export const metadata: Metadata = { title: 'Pull requests' };

/** The sample's pull request list. It has no first run: everything it shows is answered from memory. */
export default function SamplePullsPage() {
	return <PullsScreen />;
}
