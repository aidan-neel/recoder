'use client';

import type { RepoFile } from '@recoder/shared';
import { useEffect, useState } from 'react';

import { useApi } from '../api/client';
import { ApiError, failureText } from '../api/http';

/** Where reading one file stands. `missing` is a path the repository does not have at that ref. */
type FileOutcome = { phase: 'ready'; file: RepoFile } | { phase: 'missing' } | { phase: 'failed'; error: string };

/**
 * The file panel's file: what it is reading, and how that stands. While the next file loads, `previous` is the file
 * that was on show, so the panel can hold it instead of going blank for a moment.
 */
export type RepoFileView = ({ phase: 'loading'; previous: RepoFile | null } | FileOutcome) & {
	/** Reads the file again after it failed. */
	retry: () => void;
};

interface Settled {
	/** The path and attempt this outcome answers, so a newer request never shows an older one's result. */
	key: string;
	outcome: FileOutcome;
}

/** What a failed read means to the panel: a 404 is a path that is not there, anything else is a failure to say. */
function outcomeOf(error: unknown): FileOutcome {
	if (error instanceof ApiError && error.status === 404) return { phase: 'missing' };

	return { phase: 'failed', error: failureText(error) };
}

/** One file of a repository at `ref`, read again whenever `path` changes. */
export function useRepoFile(repoId: string, ref: string | undefined, path: string): RepoFileView {
	const client = useApi();
	const [attempt, setAttempt] = useState(0);
	const [settled, setSettled] = useState<Settled | null>(null);
	const key = `${attempt}:${path}`;

	useEffect(() => {
		let live = true;

		client.repoFile(repoId, path, ref).then(
			(file) => live && setSettled({ key, outcome: { phase: 'ready', file } }),
			(error: unknown) => live && setSettled({ key, outcome: outcomeOf(error) })
		);

		return () => {
			live = false;
		};
	}, [client, repoId, ref, path, key]);

	const retry = () => setAttempt((current) => current + 1);

	if (settled?.key === key) return { ...settled.outcome, retry };

	return { phase: 'loading', previous: settled?.outcome.phase === 'ready' ? settled.outcome.file : null, retry };
}
