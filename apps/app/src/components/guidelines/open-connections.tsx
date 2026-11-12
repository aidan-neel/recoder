'use client';

import { Button } from '@recoder/ui';
import Link from 'next/link';

/** Goes to Settings → Connections, where repositories are tracked and forge tokens are set. */
export function OpenConnections() {
	return (
		<Button variant="outline" asChild>
			<Link href="/settings/connections">Open Connections</Link>
		</Button>
	);
}
