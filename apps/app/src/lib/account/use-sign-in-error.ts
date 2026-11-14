'use client';

import { useEffect, useState } from 'react';

/** The query parameter the server's callback adds when a redirect sign-in ends without a session. */
const ERROR_PARAM = 'signin-error';

const MESSAGES: Record<string, string> = {
	denied: 'Sign-in was cancelled.',
	expired: 'Sign-in took too long. Try again.',
	removed: 'That account was removed from this server.',
	'setup-locked': 'Enter the setup code first.'
};

const FALLBACK_MESSAGE = 'Sign-in didn’t finish. Try again.';

/** The line for a `signin-error` code. A code this app does not know reads as a plain failure. */
function signInErrorMessage(code: string): string {
	return MESSAGES[code] ?? FALLBACK_MESSAGE;
}

/** The `signin-error` code in the address, or null. The page that reads it only ever renders in the browser. */
function codeInAddress(): string | null {
	return new URLSearchParams(window.location.search).get(ERROR_PARAM);
}

/**
 * The line to show when the server sent the browser back with `?signin-error=`.
 * The parameter is removed from the address once read, so a reload starts clean.
 */
export function useSignInError(): string | null {
	const [code] = useState(codeInAddress);

	useEffect(() => {
		const url = new URL(window.location.href);

		if (!url.searchParams.has(ERROR_PARAM)) return;

		url.searchParams.delete(ERROR_PARAM);
		window.history.replaceState(window.history.state, '', url);
	}, []);

	return code === null ? null : signInErrorMessage(code);
}
