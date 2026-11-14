'use client';

import type { SignInForge, StartDeviceSignIn } from '@recoder/shared';
import { useEffect, useState } from 'react';

import { API_BASE } from '../api/http';
import { pullsHref } from '../shell/routes';

/** The server's address for a forge's redirect sign-in: the page to leave for, and the path to come back to. */
export function oauthStartUrl(input: StartDeviceSignIn, returnPath: string, apiBase = API_BASE): string {
	const query = new URLSearchParams({ return: returnPath });

	if (input.host) query.set('host', input.host);

	return `${apiBase}/api/auth/oauth/${input.provider}/start?${query}`;
}

/** Where a redirect sign-in stands: the forge the page is leaving for, or null while none is. */
export interface RedirectSignInView {
	pending: SignInForge | null;
	/** Leaves the app for the forge's authorize page; the forge sends the browser back signed in. */
	begin: (input: StartDeviceSignIn) => void;
}

/**
 * The redirect sign-in: a full-page navigation, so the button spins until the
 * page goes. A page restored from the back button forgets the spin.
 */
export function useRedirectSignIn(): RedirectSignInView {
	const [pending, setPending] = useState<SignInForge | null>(null);

	useEffect(() => {
		const restore = (event: PageTransitionEvent): void => {
			if (event.persisted) setPending(null);
		};

		window.addEventListener('pageshow', restore);

		return () => window.removeEventListener('pageshow', restore);
	}, []);

	return {
		pending,
		begin: (input) => {
			setPending(input.provider);
			window.location.assign(oauthStartUrl(input, pullsHref('')));
		}
	};
}
