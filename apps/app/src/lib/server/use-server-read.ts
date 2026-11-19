'use client';

import { useEffect, useState } from 'react';

import { failureText } from '../api/http';

/** One read of the server, as a view shows it: the answer, why it failed, and a way to read again or take a newer answer. */
export interface ServerRead<T> {
	data: T | null;
	error: string | null;
	reload: () => void;
	take: (data: T) => void;
}

/** Reads `read` on mount and on `reload`; a failed read after a good one keeps the good one and says why. */
export function useServerRead<T>(read: () => Promise<T>, fallback: string): ServerRead<T> {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reads, setReads] = useState(0);

	useEffect(() => {
		let live = true;

		read().then(
			(next) => {
				if (!live) return;

				setData(next);
				setError(null);
			},
			(failure: unknown) => {
				if (live) setError(failureText(failure, fallback));
			}
		);

		return () => {
			live = false;
		};
	}, [read, reads, fallback]);

	return {
		data,
		error,
		reload: () => setReads((count) => count + 1),
		take: (next) => {
			setData(next);
			setError(null);
		}
	};
}
