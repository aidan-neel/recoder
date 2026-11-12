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
