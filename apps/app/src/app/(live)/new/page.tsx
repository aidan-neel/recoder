import type { Metadata } from 'next';

import { ComposeScreen } from '@/components/compose/compose-screen';

export const metadata: Metadata = { title: 'New review' };

export default function NewReviewPage() {
	return <ComposeScreen />;
}
