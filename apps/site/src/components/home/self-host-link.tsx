'use client';

import { Button } from '@recoder/ui';
import { ArrowUpRight } from 'lucide-react';

import { REPO_URL } from '~/lib/site';

/**
 * The page's main action, to the repository. It is a client component
 * because the kit's `Button` reads its child's icon to trim that side's
 * padding: from a server component the icon crosses as a reference, which
 * the server and the browser read differently, and hydration fails.
 */
export function SelfHostLink() {
	return (
		<Button asChild variant="primary" size="lg">
			<a href={REPO_URL}>
				Self-host on GitHub
				<ArrowUpRight aria-hidden />
			</a>
		</Button>
	);
}
