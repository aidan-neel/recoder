import { notFound } from 'next/navigation';

import { PullScreen } from './pull-screen';

/** The two parts of a pull request's address, as the router hands them over. */
export interface PullRouteParams {
	repoId: string;
	number: string;
}

/**
 * A pull request's page from its address. A number that is no pull request
 * number is a missing page. The `loading.tsx` beside the page paints this
 * page's own skeleton the moment a link is clicked — the same bars the
 * session shows until its data lands — so the route commits at once and the
 * page it leaves never freezes under the pointer.
 */
export function PullRoute({ repoId, number }: PullRouteParams) {
	const pull = Number(number);

	if (!Number.isInteger(pull) || pull <= 0) notFound();

	return <PullScreen repoId={decodeURIComponent(repoId)} number={pull} />;
}
