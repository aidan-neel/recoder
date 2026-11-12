'use client';

import type { ButtonStatus } from '@recoder/ui';
import { useState } from 'react';

import { trackedKeys, useConnections } from './connections-store';
import { parseRepoInput, repoKey } from './repo-input';
import { useAddRepo } from './use-add-repo';

/** Everything the Add by URL field shows and does. */
export interface AddByUrl {
	text: string;
	/** Why the last input was refused, under the field; cleared by the next keystroke. */
	error: string | null;
	/** The repository just tracked, for the "Now tracking …" hint. */
	added: string | null;
	status: ButtonStatus;
	/** The Add button is live: there is text, or a status face is still showing. */
	canSubmit: boolean;
	setText: (text: string) => void;
	/** Parses and tracks the text; a no-op while a track is running. */
	submit: () => Promise<void>;
}

/**
 * Tracks a repository from what someone pastes: `owner/name`, a link to it
 * or to any page in it, or an SSH address. A typo shows under the field
 * before anything reaches the server, and a repository already tracked is
 * named rather than added twice.
 */
export function useAddByUrl(): AddByUrl {
	const gitlabHost = useConnections((state) => state.auth?.gitlab.host ?? null);
	const [text, setTextValue] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [added, setAdded] = useState<string | null>(null);
	const [status, add] = useAddRepo();

	async function submit(): Promise<void> {
		if (status === 'pending') return;

		const parsed = parseRepoInput(text, gitlabHost);

		if (!parsed.ok) return setError(parsed.error);

		if (trackedKeys(useConnections.getState().repos).has(repoKey(parsed.repo.url))) {
			return setError(`Already tracking ${parsed.repo.name}.`);
		}

		const result = await add(parsed.repo);

		if ('error' in result) return setError(result.error);

		setTextValue('');
		setAdded(result.repo.name);
	}

	return {
		text,
		error,
		added,
		status,
		canSubmit: Boolean(text.trim()) || status !== 'idle',
		setText: (value) => {
			setTextValue(value);
			setError(null);
			setAdded(null);
		},
		submit
	};
}
