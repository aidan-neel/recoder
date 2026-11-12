import type { Metadata } from 'next';

import { AutomationsScreen } from '@/components/automations/automations-screen';

export const metadata: Metadata = { title: 'Automations' };

export default function AutomationsPage() {
	return <AutomationsScreen />;
}
