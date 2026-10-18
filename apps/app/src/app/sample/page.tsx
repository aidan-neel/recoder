import type { Metadata } from 'next';

import { QueuePage } from '@/components/queue/queue-page';

export const metadata: Metadata = { title: 'Sample queue' };

export default function Page() {
	return <QueuePage sample />;
}
