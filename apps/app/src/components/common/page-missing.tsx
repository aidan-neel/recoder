'use client';

import { Button, StatusNotice } from '@recoder/ui';
import { SearchX } from 'lucide-react';
import Link from 'next/link';

import { useApi } from '@/lib/api/client';
import { pullsHref } from '@/lib/shell/routes';

import { Page } from './page';

/** An address with no page behind it: a banner at the top of the page. The sidebar stays, with a way back to the list. */
export function PageMissing() {
	const { base } = useApi();

	return (
		<Page>
			<div className="flex flex-col px-(--page-gutter) py-5">
				<StatusNotice
					variant="banner"
					heading="h1"
					glyph={<SearchX aria-hidden />}
					title="This page does not exist."
					detail="The link may be old or mistyped."
					actions={
						<Button asChild>
							<Link href={pullsHref(base)}>Back to pull requests</Link>
						</Button>
					}
				/>
			</div>
		</Page>
	);
}
