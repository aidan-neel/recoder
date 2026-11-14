'use client';

import { useSearchParams } from 'next/navigation';

const PERSON_PARAM = 'person';

/** The person the address names (`?person=<accountId>`), and how to open or leave their view. */
export interface UsagePersonChoice {
	accountId: string | null;
	/** Opens one person's view, or everyone's with `null`. It is a history step, so Back leaves the view. */
	select: (accountId: string | null) => void;
}

/** The page's address is the state: a person's view can be linked, reloaded and left with Back. */
export function useUsagePerson(): UsagePersonChoice {
	const accountId = useSearchParams().get(PERSON_PARAM);

	function select(next: string | null): void {
		const url = new URL(window.location.href);

		if (next) url.searchParams.set(PERSON_PARAM, next);
		else url.searchParams.delete(PERSON_PARAM);

		window.history.pushState(null, '', url);
	}

	return { accountId, select };
}
