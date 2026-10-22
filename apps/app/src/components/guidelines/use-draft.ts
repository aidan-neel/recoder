'use client';

import type { GuidelinesDraftRequest } from '@recoder/shared';
import { useEffect, useRef, useState } from 'react';

import { guidelinesApi } from '@/lib/api/guidelines';
import { failureText } from '@/lib/api/http';
import { useGuidelinesEditor, type ScopeKey } from '@/lib/guidelines/editor-store';
import { streamingDraft } from '@/lib/guidelines/rules';

interface Draft {
	streaming: boolean;
	/** The draft so far, without the code fence the model may wrap it in. */
	streamed: string;
	/** Why the last draft failed, or null. */
	error: string | null;
	/** Streams a draft; resolves true once it landed in the editor. */
	run: (request: GuidelinesDraftRequest) => Promise<boolean>;
	stop: () => void;
	clearError: () => void;
}

/**
 * A draft from Orchestrator, streamed while it is written. The editor's
 * text stays as it was until the draft finishes, then the whole draft lands
 * at once and the old text is kept for Undo draft. Stopping, failing, closing
 * the editor or leaving the page all leave the text untouched.
 */
export function useDraft(key: ScopeKey, open: boolean): Draft {
	const [streaming, setStreaming] = useState(false);
	const [streamed, setStreamed] = useState('');
	const [error, setError] = useState<string | null>(null);
	const controller = useRef<AbortController | null>(null);

	useEffect(() => () => controller.current?.abort(), [open]);

	async function run(request: GuidelinesDraftRequest): Promise<boolean> {
		if (controller.current) return false;

		const abort = new AbortController();
		let raw = '';

		controller.current = abort;
		setStreaming(true);
		setStreamed('');
		setError(null);

		try {
			const text = await guidelinesApi.draft(
				request,
				(token) => {
					raw += token;
					setStreamed(streamingDraft(raw));
				},
				abort.signal
			);

			if (abort.signal.aborted) return false;

			useGuidelinesEditor.getState().landDraft(key, text);

			return true;
		} catch (failure) {
			if (!abort.signal.aborted) setError(failureText(failure, 'Orchestrator didn’t respond.'));

			return false;
		} finally {
			controller.current = null;
			setStreaming(false);
		}
	}

	return {
		streaming,
		streamed,
		error,
		run,
		stop: () => controller.current?.abort(),
		clearError: () => setError(null)
	};
}
