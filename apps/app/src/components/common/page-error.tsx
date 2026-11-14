'use client';

import { Button, StatusNotice, StatusNoticeDetails } from '@recoder/ui';
import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useApi } from '@/lib/api/client';
import { pullsHref } from '@/lib/shell/routes';

import { Page } from './page';

interface PageErrorProps {
	/** What the page threw, as Next hands it over. */
	error: unknown;
	/** Fetches and renders the page again. */
	retry: () => void;
}

/** The digest Next gives an error from the server, which its log carries too. */
function digestOf(error: unknown): string | null {
	if (typeof error !== 'object' || error === null || !('digest' in error)) return null;

	return typeof error.digest === 'string' ? error.digest : null;
}

/**
 * What a render error says, for the Details block: its message and its
 * digest, never its stack. Null when it carries neither.
 */
export function errorText(error: unknown): string | null {
	const message = error instanceof Error && error.message ? error.message : null;
	const digest = digestOf(error);
	const lines = [message, digest ? `Digest ${digest}` : null].filter((line) => line !== null);

	return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * A page that broke while rendering: a danger banner at the top of the page,
 * beside the sidebar, so the way to every other page stays. Details opens the
 * error's own words. On the list itself there is no link back to it.
 */
export function PageError({ error, retry }: PageErrorProps) {
	const { base } = useApi();
	const home = pullsHref(base);
	const onHome = usePathname() === home;
	const details = errorText(error);

	return (
		<Page>
			<div className="flex flex-col px-(--page-gutter) py-5">
				<StatusNotice
					tone="danger"
					heading="h1"
					title="This page hit an error."
					detail="Nothing you decided is lost."
					footer={details ? <StatusNoticeDetails code={details} /> : null}
					actions={
						<>
							{onHome ? null : (
								<Button asChild variant="outline">
									<Link href={home}>Back to pull requests</Link>
								</Button>
							)}
							<Button onClick={retry}>
								<RotateCcw aria-hidden />
								Try again
							</Button>
						</>
					}
				/>
			</div>
		</Page>
	);
}
