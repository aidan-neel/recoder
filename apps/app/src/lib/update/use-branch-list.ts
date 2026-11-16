'use client';

import { useRef, useState } from 'react';

import { useApi } from '../api/client';
import { failureText } from '../api/http';

/** The server's remote branches. The server fetches first, so a branch pushed a minute ago is there. */
export type BranchList =
	{ view: 'loading' } | { view: 'failed'; error: string } | { view: 'ready'; branches: string[] };

/** The branch list and the call that reads it again; only the newest read lands, so a slow earlier one never overwrites it. */
export function useBranchList(): { list: BranchList; load: () => void } {
	const { update: api } = useApi();
	const [list, setList] = useState<BranchList>({ view: 'loading' });
	const latest = useRef(0);

	function load(): void {
		const read = ++latest.current;

		setList({ view: 'loading' });

		api.branches().then(
			(result) => read === latest.current && setList({ view: 'ready', branches: result.branches }),
			(error: unknown) =>
				read === latest.current && setList({ view: 'failed', error: failureText(error, 'Couldn’t list the branches.') })
		);
	}

	return { list, load };
}
