'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

type Navigate = (href: string) => void;

/** A full page load: what a link does before the shell has given its router. */
function load(href: string): void {
	window.location.assign(href);
}

let current: Navigate = load;

/**
 * Goes to a page from code that runs outside React, such as a toast's
 * button. Inside the shell it is a client navigation; before the shell
 * mounts it loads the page.
 */
export function navigate(href: string): void {
	current(href);
}

/**
 * Moves the page on screen to other search params, such as another tab. The
 * browser's own history call skips the server round trip a router navigation
 * makes on a dynamic route, and Next still updates `useSearchParams` from it.
 */
export function replaceSearch(href: string): void {
	window.history.replaceState(null, '', href);
}

/** The shell lends its router to `navigate` while it is mounted. */
export function useNavigator(): void {
	const router = useRouter();

	useEffect(() => {
		current = (href) => router.push(href);

		return () => {
			current = load;
		};
	}, [router]);
}
