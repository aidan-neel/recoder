'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

/** Starting a review or a chat from the New screen, then opening its page. */
export interface OpenStarted {
	/** True from the press until the started page has rendered, so the send button stays pending throughout. */
	opening: boolean;
	/** Runs `begin`, then opens the page it resolves with; a rejection goes to `refuse` and the screen stays. */
	open: (begin: () => Promise<string>, refuse: (failure: unknown) => void) => void;
}

/**
 * Keeps the New screen as it was, with its text and images, until the
 * started page has rendered, then clears the draft as the screen leaves. The
 * navigation runs in a transition, so its pending state lasts until Next has
 * the new page; clearing the field first showed an empty composer for the
 * length of the route change.
 */
export function useOpenStarted(clearDraft: () => void): OpenStarted {
	const router = useRouter();
	const [starting, setStarting] = useState(false);
	const [navigating, startNavigating] = useTransition();
	const opened = useRef(false);
	const clear = useRef(clearDraft);

	useEffect(() => {
		clear.current = clearDraft;
	}, [clearDraft]);

	useEffect(
		() => () => {
			if (opened.current) clear.current();
		},
		[]
	);

	function open(begin: () => Promise<string>, refuse: (failure: unknown) => void): void {
		setStarting(true);

		begin().then(
			(href) => {
				opened.current = true;

				startNavigating(() => {
					setStarting(false);
					router.push(href);
				});
			},
			(failure: unknown) => {
				setStarting(false);
				refuse(failure);
			}
		);
	}

	return { opening: starting || navigating, open };
}
