'use client';

import { useEffect, useRef } from 'react';

/**
 * Keeps keyboard focus with the person's view as it opens and closes: onto the
 * way back when one opens, and onto the person's row when it closes. A page
 * that loads already on a person's view keeps the focus where it is.
 */
export function usePersonFocus(accountId: string | null): void {
	const shown = useRef(accountId);

	useEffect(() => {
		const before = shown.current;

		shown.current = accountId;

		if (before === accountId) return;

		const target = accountId
			? document.querySelector('[data-usage-back]')
			: document.querySelector(`[data-person-id="${CSS.escape(before ?? '')}"]`);

		if (target instanceof HTMLElement) target.focus();
	}, [accountId]);
}
