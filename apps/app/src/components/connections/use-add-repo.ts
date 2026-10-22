'use client';

import type { CreateRepoInput, Repo } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect, useState } from 'react';

import { failureText } from '@/lib/api/http';
import { useConnections } from '@/lib/connections/connections-store';

/** How long the button's success or failure face shows before it reads "Add" again. */
const SETTLE_MS = 1400;

/** A track request's outcome: the new repository, or why the server refused it. */
type AddResult = { repo: Repo } | { error: string };

/**
 * Tracks a repository from a button: pending while the server adds it, then
 * a short success or failure face before the button reads "Add" again.
 */
export function useAddRepo(): [ButtonStatus, (input: CreateRepoInput) => Promise<AddResult>] {
	const [status, setStatus] = useState<ButtonStatus>('idle');

	useEffect(() => {
		if (status !== 'success' && status !== 'error') return;

		const timer = setTimeout(() => setStatus('idle'), SETTLE_MS);

		return () => clearTimeout(timer);
	}, [status]);

	async function add(input: CreateRepoInput): Promise<AddResult> {
		setStatus('pending');

		try {
			const repo = await useConnections.getState().addRepo(input);

			setStatus('success');

			return { repo };
		} catch (error) {
			setStatus('error');

			return { error: failureText(error, 'The server didn’t add it.') };
		}
	}

	return [status, add];
}
