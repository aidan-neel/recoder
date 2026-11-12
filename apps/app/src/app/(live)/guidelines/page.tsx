import type { Metadata } from 'next';

import { GuidelinesScreen } from '@/components/guidelines/guidelines-screen';

export const metadata: Metadata = { title: 'Guidelines' };

export default function GuidelinesPage() {
	return <GuidelinesScreen />;
}
