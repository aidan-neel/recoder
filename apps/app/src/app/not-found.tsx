import { Button } from '@recoder/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageNotice } from '@/components/common/page-notice';

export const metadata: Metadata = { title: 'Not found' };

/** An unknown address, or a settings section that does not exist. The top bar stays, with a way back. */
export default function NotFound() {
	return (
		<PageNotice lead="This page doesn’t exist.">
			<Button asChild variant="primary">
				<Link href="/">Back to the queue</Link>
			</Button>
		</PageNotice>
	);
}
