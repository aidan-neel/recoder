import { notFound } from 'next/navigation';

import { PullScreen } from './pull-screen';

/** The two parts of a pull request's address, as the router hands them over. */
export interface PullRouteParams {
	repoId: string;
	number: string;
}

/**
 * A pull request's page from its address. A number that is no pull request
 * number is a missing page. The route has no `loading.tsx`: a Suspense
 * fallback makes React hold the real page back until 300 ms after the
 * fallback painted, and the session only starts reading once the page
 * mounts. The screen paints the same skeleton itself until its data lands.
 */
export function PullRoute({ repoId, number }: PullRouteParams) {
	const pull = Number(number);

	if (!Number.isInteger(pull) || pull <= 0) notFound();

	return <PullScreen repoId={decodeURIComponent(repoId)} number={pull} />;
}
