'use client';

import { Button, StatusNotice } from '@recoder/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useApi } from '@/lib/api/client';
import { pullsHref } from '@/lib/shell/routes';

import { Page } from './page';

interface PageErrorProps {
	/** Fetches and renders the page again. */
	retry: () => void;
}

/**
 * A page that broke while rendering. It shows beside the sidebar, so the way
 * to every other page stays. On the list itself there is no link back to it.
 */
export function PageError({ retry }: PageErrorProps) {
	const { base } = useApi();
	const home = pullsHref(base);
	const onHome = usePathname() === home;

	return (
		<Page>
			<div className="page-notice">
				<StatusNotice
					tone="danger"
					heading="h1"
					title="This page hit an error."
					detail="Nothing you decided is lost."
					actions={
						<>
							<Button onClick={retry}>Try again</Button>
							{onHome ? null : (
								<Button asChild variant="outline">
									<Link href={home}>Back to pull requests</Link>
								</Button>
							)}
						</>
					}
				/>
			</div>
		</Page>
	);
}
