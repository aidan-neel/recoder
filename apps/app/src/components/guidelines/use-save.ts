'use client';

import type { GlobalGuidelines, GuidelinesProposal } from '@recoder/shared';
import { toast, type ButtonStatus } from '@recoder/ui';
import { useState } from 'react';

import { failureText } from '@/lib/api/http';
import { useGuidelinesEditor } from '@/lib/guidelines/editor-store';
import { useGuidelines } from '@/lib/guidelines/guidelines-store';
import { errorToast, undoToast } from '@/lib/shell/notify';

/** Puts the global layer back as it was, after Undo on the saved toast. */
function restoreGlobal(previous: GlobalGuidelines): void {
	void useGuidelines
		.getState()
		.restoreGlobal(previous)
		.catch((error: unknown) => errorToast('Couldn’t restore the guidelines', failureText(error, 'Try again.')));
}

/** The pull request is the result: name it and link to it. */
function proposalToast(proposal: GuidelinesProposal): void {
	toast.success(proposal.updated ? `Updated #${proposal.number}` : `Opened #${proposal.number}`, {
		description: 'Reviews follow the new guidelines once it merges.',
		duration: 8000,
		action: { label: 'View', onClick: () => window.open(proposal.url, '_blank', 'noopener') }
	});
}

/**
 * Save for the global layer, Open pull request for a repository's file. On
 * success the editor folds away (its button shows the check meanwhile) and a
 * toast confirms: Undo for the global layer, the pull request for a repo. On
 * failure the button turns to "Try again" and the reason shows above it.
 */
export function useSave(repoId: string | null): {
	status: ButtonStatus;
	error: string | null;
	save: (text: string) => Promise<void>;
	reset: () => void;
} {
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const [error, setError] = useState<string | null>(null);

	async function save(text: string): Promise<void> {
		if (status === 'pending') return;

		setStatus('pending');
		setError(null);

		try {
			if (repoId) {
				proposalToast(await useGuidelines.getState().propose(repoId, text));
			} else {
				const previous = await useGuidelines.getState().saveGlobal(text);

				undoToast('Global guidelines saved', () => restoreGlobal(previous));
			}
		} catch (failure) {
			setStatus('error');
			setError(failureText(failure, 'Couldn’t save the guidelines.'));

			return;
		}

		setStatus('success');
		useGuidelinesEditor.getState().close();
	}

	function reset(): void {
		if (status === 'error') setStatus('idle');

		setError(null);
	}

	return { status, error, save, reset };
}
