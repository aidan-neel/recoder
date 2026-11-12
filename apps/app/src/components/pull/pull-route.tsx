import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { PullScreen } from './pull-screen';

/** The two parts of a pull request's address, as the router hands them over. */
export interface PullRouteParams {
	repoId: string;
	number: string;
}

/**
 * A pull request's page from its address. A number that is no pull request
 * number is a missing page. The screen reads its tab from the address, so it
 * renders inside a boundary the router can suspend.
 */
export function PullRoute({ repoId, number }: PullRouteParams) {
	const pull = Number(number);

	if (!Number.isInteger(pull) || pull <= 0) notFound();

	return (
		<Suspense fallback={null}>
			<PullScreen repoId={decodeURIComponent(repoId)} number={pull} />
		</Suspense>
	);
}
